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
const point = (codePoint: number): string =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

// The refusal messages of the alphabet (rule 1) and of the HTML rule (rule 2).
const OUTSIDE = (line: number, column: number, codePoint: number, category: string): string =>
  `line ${line}, column ${column}, ${point(codePoint)} (${category}): outside the alphabet of a PRD (ASCII, the Latin-1 letters, punctuation, symbols, spaces and the tab)`;
const NOT_NFC = (line: number, column: number, codePoint: number, category: string): string =>
  `line ${line}, column ${column}, ${point(codePoint)} (${category}): not in Unicode normalization form C`;
const HTML = (line: number, column: number, snippet: string): string =>
  `line ${line}, column ${column}: "${snippet}" opens HTML markup (a tag, a comment, a processing instruction or an entity), which a PRD never holds`;
const MENTION = (line: number): string =>
  `line ${line}: "Maturité du document" outside a strict declaration line (\`Maturité du document : <level>\`, at most three spaces of indentation, an optional bullet and bold) is not read`;
const SPLIT_MENTION = (line: number): string =>
  `lines ${line} and ${line + 1}: "Maturité du document" split across a line end is not read`;
const CRITERION_FORM = (line: number): string =>
  `line ${line}: a CA-<n> definition that is not a strict criterion bullet ("- CA-<n> …", at most three spaces of indentation) is not read`;
const ROW_OUTSIDE = (line: number): string =>
  `line ${line}: a WP-<n> row outside the block of the work-package table is not read`;
const HEADER_LIKE = (line: number): string =>
  `line ${line}: a work-package table header that is not the exact header (\`| WP | CA-n | Périmètre | Vérification | Porte |\`, plain cells) is not read`;

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

  test("a word that merely ends with Validation is not the clause", () => {
    expect(parseCriteria("- CA-1 x. Invalidation : aucune\n- CA-2 y. InValidation : z\n")).toEqual({
      ok: true,
      value: [
        { id: "CA-1", line: 1, hasValidation: false },
        { id: "CA-2", line: 2, hasValidation: false },
      ],
    });
  });

  test("a duplicated CA id is ok:false naming the id and both lines", () => {
    expect(
      refusalOf(parseCriteria("- CA-1 First. Validation : a\n\n- CA-1 Again. Validation : b\n")),
    ).toBe("criterion CA-1 is declared twice, at lines 1 and 3");
  });

  // Rule 4: two spellings of one number are one criterion.
  test("CA-01 and CA-1 name the same criterion: declared twice", () => {
    expect(refusalOf(parseCriteria("- CA-1 First. Validation : a\n- CA-01 Again.\n"))).toBe(
      "criterion CA-01 is declared twice, at lines 1 and 2 (CA-1 and CA-01 name the same number)",
    );
  });

  test("CA-1 and CA-10 are distinct criteria", () => {
    const result = parseCriteria("- CA-1 First. Validation : a\n- CA-10 Tenth. Validation : b\n");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((criterion) => criterion.id)).toEqual(["CA-1", "CA-10"]);
  });

  // The raw text is the authority: a criterion quoted in a fence is a
  // criterion, as the reviewer of the raw diff reads it.
  test("a CA-n definition inside a fence is read as live", () => {
    const markdown: string = [
      "- CA-1 Real. Validation : a",
      THREE,
      "- CA-2 In a fence. Validation : b",
      THREE,
    ].join("\n");
    expect(parseCriteria(markdown)).toEqual({
      ok: true,
      value: [
        { id: "CA-1", line: 1, hasValidation: true },
        { id: "CA-2", line: 3, hasValidation: true },
      ],
    });
  });

  test("a document without any criterion is ok:true with zero entries, never an error", () => {
    expect(parseCriteria("# Nothing here\n")).toEqual({ ok: true, value: [] });
  });
});

// Rule 4: on the folded line, after every leading character that is not a
// letter or a digit (an ordered-list number and a task-list box included), a
// first token `ca-<digits>` is a definition form: a strict bullet, or refused.
describe("criteria: every definition form is strict or refused", () => {
  test.each([
    [
      "C1 an indented example",
      ["- CA-1 real. Validation : a", "", "    - CA-9 example. Validation : x"],
      3,
    ],
    ["a tab before the bullet", ["\t- CA-9 x. Validation : y"], 1],
    ["an ordered item", ["1. CA-9 x. Validation : y"], 1],
    ["an ordered item with a parenthesis", ["1) CA-9 x. Validation : y"], 1],
    ["a quote", ["> - CA-9 x. Validation : y"], 1],
    ["a nested quote", ["> > - CA-9 x. Validation : y"], 1],
    ["no bullet", ["CA-9 x. Validation : y"], 1],
    ["the colon form", ["CA-9 : x"], 1],
    ["a heading", ["### CA-9 x"], 1],
    ["underscore emphasis", ["- __CA-9__ x. Validation : y"], 1],
    ["strikethrough", ["- ~~CA-9~~ x"], 1],
    ["a link", ["- [CA-9](x) y"], 1],
    ["a task-list box", ["- [ ] CA-9 x. Validation : y"], 1],
    ["a checked task-list box", ["- [x] CA-9 x. Validation : y"], 1],
    ["a table row", ["| CA-9 | covered by WP-1 |"], 1],
    ["an indented table row", ["  | CA-9 | x |"], 1],
    ["lower case", ["- ca-9 x. Validation : y"], 1],
    ["an en dash", [`- CA${char(0x2013)}9 x. Validation : y`], 1],
    ["a non-breaking hyphen", [`- CA${char(0x2011)}9 x. Validation : y`], 1],
    ["a minus sign", [`- CA${char(0x2212)}9 x. Validation : y`], 1],
    ["a fullwidth hyphen", [`- CA${char(0xff0d)}9 x. Validation : y`], 1],
    ["a letter glued to the number", ["- CA-9é x. Validation : y"], 1],
    ["a second definition in a quote", ["- CA-1 a. Validation : x", "> - CA-1 again"], 2],
  ])("%s is refused with its line", (_label: string, lines: string[], at: number) => {
    expect(refusalOf(parseCriteria(lines.join("\n")))).toBe(CRITERION_FORM(at));
  });

  test("a CA-n in the middle of a line is not a definition", () => {
    const markdown: string = [
      "See CA-3 for the rule.",
      "- WP-1 covers CA-3.",
      "Les critères CA-1 et CA-2 sont liés.",
      "- CA-1 Real. Validation : a",
    ].join("\n");
    expect(parseCriteria(markdown)).toEqual({
      ok: true,
      value: [{ id: "CA-1", line: 4, hasValidation: true }],
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

  // A table quoted in a fence is THE table: the raw text is read.
  test("a table inside a fenced block is read as live", () => {
    const fenced = [
      THREE,
      table("| `WP-1` | `CA-3` | `a/**` | `bun test` | `two-way` |"),
      THREE,
    ].join("\n");
    expect(parseWorkPackages(fenced).ok).toBe(true);
  });
});

// One strict header, every header-like line is that header, and every
// `WP-<n>` row with a pipe belongs to its block.
describe("work-package table: one strict header, rows in its block", () => {
  const ROW: string = "| `WP-1` | `CA-1` | `a/**` | `bun test` | `one-way` |";
  const EXAMPLE: readonly string[] = [
    "| WP | CA-n | Périmètre | Vérification | Porte |",
    "| --- | --- | --- | --- | --- |",
    "| `WP-1` | `CA-1` | `**` | `true` | `two-way` |",
  ];

  test("T1 a header without leading pipe after a fenced example is refused", () => {
    const markdown: string = [
      THREE,
      ...EXAMPLE,
      THREE,
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
    expect(refusalOf(parseWorkPackages(markdown))).toBe(ROW_OUTSIDE(4));
  });

  test("a WP row after a blank line that ends the table is refused", () => {
    const markdown: string = [
      TABLE_HEADER,
      TABLE_RULE,
      ROW,
      "",
      "| `WP-2` | `CA-2` | `b/**` | `x` | `two-way` |",
    ].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(ROW_OUTSIDE(5));
  });

  // Rule 4: a row form is recognised after every leading character that is
  // not a letter or a digit, and through the folded dashes and pipes.
  test.each([
    ["a quoted row", "> | WP-2 | CA-1 | ** | true | two-way |"],
    ["a row in a list item", "- | WP-2 | CA-1 | ** | true | two-way |"],
    ["a linked id", "[WP-2](x) | CA-1 | ** | true | two-way |"],
    ["a struck id", "~~WP-2~~ | CA-1 | ** | true | two-way |"],
    ["a bold id", "| **WP-2** | CA-1 | ** | true | two-way |"],
    ["a non-breaking hyphen", `| WP${char(0x2011)}2 | CA-1 | ** | true | two-way |`],
    ["an en dash", `| WP${char(0x2013)}2 | CA-1 | ** | true | two-way |`],
    ["fullwidth pipes", `${char(0xff5c)} WP-2 ${char(0xff5c)} CA-1 ${char(0xff5c)}`],
    ["an indented row", "    | WP-2 | CA-1 | ** | true | two-way |"],
  ])("%s outside the block is refused", (_label: string, line: string) => {
    const markdown: string = [TABLE_HEADER, TABLE_RULE, ROW, "", line].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(ROW_OUTSIDE(5));
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

  test("T9 a table quoted in a comment is refused as HTML, before any table is read", () => {
    const markdown: string = ["<!--", ...EXAMPLE, "-->", TABLE_HEADER, TABLE_RULE, ROW].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(HTML(1, 1, "<!"));
  });

  test("a header written with an entity pipe is refused as HTML", () => {
    const markdown: string = [
      "WP &#124; CA-n &#124; Périmètre &#124; Vérification &#124; Porte",
      TABLE_HEADER,
      TABLE_RULE,
      ROW,
    ].join("\n");
    expect(refusalOf(parseWorkPackages(markdown))).toBe(HTML(1, 4, "&#124;"));
  });

  test("a legitimate PRD with fences and a risk table that hold no declaration form is read", () => {
    const markdown: string = [
      "# PRD",
      "~~~",
      "x",
      "~~~",
      `${THREE}ts`,
      "const y: number = 1 | 2;",
      THREE,
      "| Risque | Probabilité | Impact |",
      "| --- | --- | --- |",
      "| Quota | faible | moyen |",
      TABLE_HEADER,
      TABLE_RULE,
      ROW,
      "",
      "Le WP-1 livre l'export, café & thé — ç’est « bien ».",
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

  // Rule 5: after the level, only an ASCII boundary (end, space, tab, ASCII
  // punctuation) is accepted; any other character means no level.
  const boundaries: readonly (readonly [string, string, MaturityLevel | null])[] = [
    ["the end of the line", "décision", "décision"],
    ["a space", "décision (arbitrage)", "décision"],
    ["a tab", "décision\tx", "décision"],
    ["an ASCII full stop", "décision.", "décision"],
    ["an ASCII hyphen", "décision-nelle", "décision"],
    ["an ASCII question mark", "décision? non : exploration", "décision"],
    ["a trailing bold marker", "décision**", "décision"],
    ["a letter: décisionnel", "décisionnel", null],
    ["an accented letter glued", "décisioné", null],
    ["an en dash glued", `décision${char(0x2013)} x`, null],
    ["a no-break space glued", `décision${char(0x00a0)}x`, null],
    ["a symbol glued", `décision${char(0x2192)} x`, null],
    ["a digit glued", "décision2", null],
  ];
  test.each(
    boundaries,
  )("the value followed by %s", (_label: string, value: string, level: MaturityLevel | null) => {
    expect(maturityOf(`Maturité du document : ${value}\n`)).toBe(level);
  });

  // A declaration quoted in a fence is a declaration: the raw text is read.
  test("a declaration inside a fenced block is read as live", () => {
    expect(maturityOf(`${THREE}\nMaturité du document : décision\n${THREE}\n`)).toBe("décision");
  });

  test("case is ignored on a strict line", () => {
    expect(maturityOf("MATURITÉ DU DOCUMENT : décision")).toBe("décision");
  });
});

// Every line that mentions "maturité du document", once folded, is exactly
// one strict declaration line, or the document is refused. The review cases
// M1-M17 of f11a129 read `décision` where a human reads `proposition`; each
// now gives a refusal or no level, never décision.
describe("maturity: every mention is a strict declaration", () => {
  const T: string = THREE;
  const cases: readonly (readonly [string, readonly string[], string | null])[] = [
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
      ["<div>", T, "</div>", "", "Maturité du document : proposition"],
      HTML(1, 1, "<d"),
    ],
    [
      "M4 details block",
      ["<details><summary>x</summary>", T, "</details>", "", "Maturité du document : proposition"],
      HTML(1, 1, "<d"),
    ],
    [
      "M5 bold label",
      ["**Maturité du document** : proposition", "", "Maturité du document : décision"],
      MENTION(1),
    ],
    [
      "M6 indented example",
      ["Maturité du document : proposition", "", "    Maturité du document : décision"],
      MENTION(3),
    ],
    [
      "M7 escaped colon",
      ["Maturité du document \\: proposition", "", "Maturité du document : décision"],
      MENTION(1),
    ],
    [
      "M8 entity in the label",
      ["Maturit&eacute; du document : proposition", "", "Maturité du document : décision"],
      HTML(1, 8, "&eacute;"),
    ],
    [
      "M9 decomposed accent",
      [`Maturite${char(0x0301)} du document : proposition`, "", "Maturité du document : décision"],
      OUTSIDE(1, 9, 0x0301, "Mn"),
    ],
    [
      "M10 heading",
      ["## Maturité du document : proposition", "", "Maturité du document : décision"],
      MENTION(1),
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
      ["Maturité du document : proposition", "", '<script type="text/plain">'],
      HTML(3, 1, "<s"),
    ],
    ["M13 CDATA", ["Maturité du document : proposition", "", "<![CDATA["], HTML(3, 1, "<!")],
    [
      "M14 declaration block",
      ["Maturité du document : proposition", "", "<!X", "Maturité du document : décision", ">"],
      HTML(3, 1, "<!"),
    ],
    [
      "M15 --!> comment end",
      ["<!-- a --!>", "Maturité du document : proposition", "-->"],
      HTML(1, 1, "<!"),
    ],
    [
      "M16 nested list fence indented by five",
      ["- a", "   - b", "", `     ${T}`, "     Maturité du document : décision", `     ${T}`],
      MENTION(5),
    ],
    [
      "M17 tab-indented fence in a list item",
      ["- a", "", `\t${T}`, "\tMaturité du document : décision", `\t${T}`],
      MENTION(4),
    ],
    [
      "H28 a hard line end inside the label",
      ["Maturité du", "document : proposition"],
      SPLIT_MENTION(1),
    ],
    [
      "H29 a setext heading is a strict line, in disagreement with the other",
      ["Maturité du document : proposition", "===", "", "Maturité du document : décision"],
      null,
    ],
  ];

  test.each(cases)("%s never reads décision", (_label: string, lines: readonly string[], reason:
    | string
    | null) => {
    const result: Parsed<MaturityLevel | null> = readDocumentMaturity(lines.join("\n"));
    if (reason === null) {
      expect(result).toEqual({ ok: true, value: null });
    } else {
      expect(result).toEqual({ ok: false, reason });
    }
  });

  test.each([
    ["a backslash", "Maturit\\é du document : décision"],
    ["emphasis inside the words", "Matu**rité** du document : décision"],
    ["underscore emphasis", "_Maturité du document_ : décision"],
    ["strikethrough", "~~Maturité du document~~ : décision"],
    ["a code span", "`Maturité du document` : décision"],
    ["a fullwidth colon", `Maturité du document ${char(0xff1a)} décision`],
    ["a ratio colon", `Maturité du document ${char(0x2236)} décision`],
    ["a no-break space between the words", `Maturité${char(0x00a0)}du document : décision`],
    ["a tab between the words", "Maturité\tdu document : décision"],
    ["a braille blank inside a word", `Matu${char(0x2800)}rité du document : décision`],
    ["a punctuation inside a word", "Matu.rité du document : décision"],
    ["an indent of four", "    Maturité du document : décision"],
    ["a tab indent", "\tMaturité du document : décision"],
    ["a quote", "> Maturité du document : décision"],
    ["an ordered item", "1. Maturité du document : décision"],
    ["a table cell", "| Maturité du document : décision |"],
    ["a link", "[Maturité du document](x) : décision"],
    ["an image", "![Maturité du document : décision](x.png)"],
    ["prose", "La maturité du document est une décision."],
    [
      "two mentions on one line",
      "Maturité du document : décision, Maturité du document : proposition",
    ],
  ])("%s is refused with its line", (_label: string, line: string) => {
    expect(readDocumentMaturity(`# PRD\n${line}`)).toEqual({ ok: false, reason: MENTION(2) });
  });

  test("a mention split across a line end names both lines, and only a real split is one", () => {
    expect(refusalOf(readDocumentMaturity("# PRD\nx Maturité du\n  document : x\n"))).toBe(
      SPLIT_MENTION(2),
    );
    // A strict line followed by a line that starts with "document" is no split.
    expect(maturityOf("Maturité du document : décision\ndocument suivant\n")).toBe("décision");
  });
});

// Rule 1: the alphabet of a PRD is closed. Every character of the document is
// the tab, a line end, a space (Zs), an ASCII digit, an ASCII or Latin-1
// letter, a punctuation or a symbol; the text is in NFC. Anything else is
// refused naming the line, the column and the code point.
describe("the alphabet of a PRD", () => {
  const STRICT: string = "Maturité du document : décision";

  test.each([
    ["a zero-width space", 0x200b, "Cf"],
    ["a soft hyphen", 0x00ad, "Cf"],
    ["a word joiner", 0x2060, "Cf"],
    ["a byte order mark", 0xfeff, "Cf"],
    ["a zero-width joiner", 0x200d, "Cf"],
    ["a right-to-left override", 0x202e, "Cf"],
    ["a left-to-right isolate", 0x2066, "Cf"],
    ["a combining acute accent", 0x0301, "Mn"],
    ["a combining long solidus overlay", 0x0338, "Mn"],
    ["a combining enclosing keycap", 0x20e3, "Me"],
    ["a hangul filler", 0x3164, "Lo"],
    ["a halfwidth hangul filler", 0xffa0, "Lo"],
    ["a Cyrillic a", 0x0430, "Ll"],
    ["a Cyrillic capital er", 0x0420, "Lu"],
    ["a Greek omicron", 0x03bf, "Ll"],
    ["a dotless i", 0x0131, "Ll"],
    ["a fullwidth capital M", 0xff2d, "Lu"],
    ["a micro sign", 0x00b5, "Ll"],
    ["a modifier letter small r", 0x02b3, "Lm"],
    ["a feminine ordinal indicator", 0x00aa, "Lo"],
    ["a Latin small letter n with grave", 0x01f9, "Ll"],
    ["a fullwidth digit one", 0xff11, "Nd"],
    ["an Arabic-Indic digit one", 0x0661, "Nd"],
    ["a Roman numeral one", 0x2160, "Nl"],
    ["a circled digit one", 0x2460, "No"],
    ["a NUL", 0x0000, "Cc"],
    ["a vertical tab", 0x000b, "Cc"],
    ["a unit separator", 0x001f, "Cc"],
    ["a DEL", 0x007f, "Cc"],
    ["a C1 control", 0x0080, "Cc"],
    ["a next line", 0x0085, "Cc"],
    ["a line separator", 0x2028, "Zl"],
    ["a paragraph separator", 0x2029, "Zp"],
    ["a private-use character", 0xe000, "Co"],
    ["an unassigned code point", 0x0378, "Cn"],
    ["a lone surrogate", 0xd800, "Cs"],
  ])("%s is refused with its line, column and category, by every reader", (_label: string, codePoint: number, category: string) => {
    const markdown: string = [STRICT, `x${char(codePoint)}y`].join("\r\n");
    const expected: string = OUTSIDE(2, 2, codePoint, category);
    for (const result of [
      readRawLines(markdown),
      readDocumentMaturity(markdown),
      parseCriteria(markdown),
      parseWorkPackages(markdown),
    ] as readonly Parsed<unknown>[]) {
      expect(refusalOf(result)).toBe(expected);
    }
  });

  test("the column counts code points, not UTF-16 units", () => {
    const line: string = `${char(0x1f600)}é${char(0x200b)}`;
    expect(refusalOf(readRawLines(line))).toBe(OUTSIDE(1, 3, 0x200b, "Cf"));
  });

  test("the first offending character of the first offending line is named", () => {
    const markdown: string = ["ok", `a${char(0x0430)}b${char(0x200b)}`, `${char(0x200b)}`].join(
      "\n",
    );
    expect(refusalOf(readRawLines(markdown))).toBe(OUTSIDE(2, 2, 0x0430, "Ll"));
  });

  test.each([
    ["an en quad", 0x2000, "Zs"],
    ["a Greek varia", 0x1fef, "Sk"],
  ])("%s, which is not in NFC, is refused", (_label: string, codePoint: number, category: string) => {
    expect(refusalOf(readRawLines(`ab${char(codePoint)}c`))).toBe(
      NOT_NFC(1, 3, codePoint, category),
    );
  });

  test("the variation selector 16 is accepted right after a symbol, nowhere else", () => {
    expect(readRawLines(`${char(0x26a0)}${char(0xfe0f)} attention`).ok).toBe(true);
    expect(refusalOf(readRawLines(`e${char(0xfe0f)}`))).toBe(OUTSIDE(1, 2, 0xfe0f, "Mn"));
    expect(refusalOf(readRawLines(`${char(0xfe0f)}`))).toBe(OUTSIDE(1, 1, 0xfe0f, "Mn"));
    expect(refusalOf(readRawLines(`1${char(0xfe0f)}${char(0x20e3)}`))).toBe(
      OUTSIDE(1, 2, 0xfe0f, "Mn"),
    );
  });

  test("the Latin-1 letters, Œ œ Ÿ, punctuation, symbols, spaces and the tab are accepted", () => {
    const text: string = [
      "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß",
      "àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ",
      `${char(0x0152)}${char(0x0153)}${char(0x0178)}`,
      "§ « » — – … → ≤ ≥ ≠ × ÷ ° € ™ ‖ ′ ∈ ⇒ ⚠️ ✅ 🚀 ¦ ¬ ± ¶ · ¿ ¡",
      `a${char(0x00a0)}b${char(0x3000)}c${char(0x1680)}d\te`,
      "a < b, R&D, Q&A, AT&T, a & b, &#, <3, < b, 1 << 2, &;",
    ].join("\n");
    expect(readRawLines(text).ok).toBe(true);
    expect(maturityOf(`${text}\n${STRICT}`)).toBe("décision");
  });
});

// Rule 2: a PRD holds no HTML. A `<` that opens a tag, a comment, a
// processing instruction or a declaration, and an entity with or without its
// semicolon, are refused naming the line and the column.
describe("no HTML in a PRD", () => {
  test.each([
    ["an opening tag", "a <b>c</b>", 3, "<b"],
    ["a closing tag first", "a </b>", 3, "</"],
    ["a comment", "a <!-- x -->", 3, "<!"],
    ["a processing instruction", "a <?x?>", 3, "<?"],
    ["a CDATA section", "a <![CDATA[x]]>", 3, "<!"],
    ["a declaration", "<!X", 1, "<!"],
    ["a tag inside a word", "Matu<b></b>rité", 5, "<b"],
    ["a named entity", "caf&eacute;", 4, "&eacute;"],
    ["a named entity without its semicolon", "caf&eacute du", 4, "&eacute"],
    ["a two-letter legacy entity without its semicolon", "a &lt b", 3, "&lt"],
    ["an entity of the ampersand", "a &amp; b", 3, "&amp;"],
    ["a one-letter entity with its semicolon", "a &a; b", 3, "&a;"],
    ["a decimal entity", "Maturit&#233; du", 8, "&#233;"],
    ["a decimal entity without its semicolon", "Maturit&#233 du", 8, "&#233"],
    ["a hexadecimal entity", "Maturit&#xE9; du", 8, "&#xE9;"],
    ["an uppercase hexadecimal marker", "a&#X41;", 2, "&#X41;"],
    ["an entity after a Latin-1 letter", "é&#8203;x", 2, "&#8203;"],
  ])("%s is refused with its line and column, by every reader", (_label: string, line: string, column: number, snippet: string) => {
    const markdown: string = ["Maturité du document : décision", line].join("\n");
    const expected: string = HTML(2, column, snippet);
    for (const result of [
      readRawLines(markdown),
      readDocumentMaturity(markdown),
      parseCriteria(markdown),
      parseWorkPackages(markdown),
    ] as readonly Parsed<unknown>[]) {
      expect(refusalOf(result)).toBe(expected);
    }
  });

  test("the alphabet is checked before the HTML rule on one line", () => {
    expect(refusalOf(readRawLines(`<b>${char(0x200b)}`))).toBe(OUTSIDE(1, 4, 0x200b, "Cf"));
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
    expect(refusalOf(readRawLines(`a\r\nb\rc${char(0x200b)}`))).toBe(OUTSIDE(3, 2, 0x200b, "Cf"));
  });

  test("a tab and a no-break space are accepted", () => {
    const nbsp: string = char(0x00a0);
    expect(maturityOf(`x\ty${nbsp}z\nMaturité du document : décision`)).toBe("décision");
  });

  // Rule 3: the detection form folds only what the alphabet lets through.
  test("the detection form folds case, accents, emphasis, backslashes, spaces, dashes, colons and pipes", () => {
    expect(detectionForm("  Matu**rité**  _du_\t`document` \\: x~~y~~")).toBe(
      " maturite du document : xy",
    );
    expect(
      detectionForm(`WP${char(0x2011)}1${char(0xff5c)}CA${char(0x2212)}2 ${char(0xff1a)} ÀÉŒß`),
    ).toBe("wp-1|ca-2 : aeœß");
    expect(detectionForm(`a${char(0x00a0)}${char(0x3000)}b`)).toBe("a b");
    for (const dash of [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe63, 0xff0d]) {
      expect(detectionForm(`CA${char(dash)}1`)).toBe("ca-1");
    }
    for (const colon of [0xff1a, 0x2236, 0xfe55, 0xa789]) {
      expect(detectionForm(`a${char(colon)}b`)).toBe("a:b");
    }
    for (const pipe of [0xff5c, 0x2223, 0xffe4, 0x00a6]) {
      expect(detectionForm(`a${char(pipe)}b`)).toBe("a|b");
    }
  });

  test("the reader stays linear: 200 000 mixed lines in under a second", () => {
    const block: readonly string[] = [
      "## Contexte — état « observé »",
      "x",
      THREE,
      "const y: number = 1 | 2;",
      THREE,
      "- CA-1 a. Validation : b",
      "text `code` more with é, ç’est ≤ 3 → fin…",
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
    expect(tableRead).toEqual({
      ok: false,
      reason:
        "work-package table not found (expected header: WP | CA-n | Périmètre | Vérification | Porte)",
    });
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

  // The norm quotes every declaration form, and names HTML constructions, so
  // read as a PRD it is refused: that is assumed (it is a norm, not a PRD)
  // and pinned here.
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

  // Wave H4: the norm enumerates what a PRD may contain (the alphabet, no
  // HTML), states the fold and the refusals, and no longer describes a reader
  // that decodes, strips or detects an open class of spellings.
  test("the norm states the alphabet, the HTML rule, the fold and the refusals", async () => {
    const text: string = await readNorm();
    for (const sentence of [
      "Every raw occurrence of a declaration form is either read as live or makes the document unreadable",
      "A PRD therefore never quotes a declaration form, not even in a fence, an indented block or a list item: it paraphrases it.",
      "the invariant is held by enumerating what a document may contain, not by detecting what it must not",
      "the tab; a line end (LF, CR LF or a lone CR); a space of category Zs (the no-break space included); an ASCII digit; an ASCII letter; a precomposed Latin-1 letter (`À` to `ÿ`) and `Œ`, `œ`, `Ÿ`; any punctuation (P*) and any symbol (S*).",
      "the variation selector U+FE0F directly after a symbol of category So",
      "Everything else is refused naming the line, the column (counted in code points) and the code point with its Unicode category",
      "the format characters (Cf: U+00AD, U+200B to U+200F, U+2060, U+FEFF, the bidirectional controls, the zero-width joiner U+200D)",
      "The text MUST be in Unicode normalization form C",
      "A PRD holds no HTML.",
      "`a < b`, `R&D`, `Q&A` and `a & b` are permitted",
      "A `<` immediately followed by a letter, `!`, `?` or `/`",
      "with or without its semicolon",
      "the only folding the parsers do, and it folds only characters the alphabet lets through",
      "the accents of the Latin-1 letters are removed",
      "the dashes `‐ ‑ ‒ – — ― − ﹣ －` are read as `-`, the colons `： ∶ ﹕ ꞉` as `:` and the bars `｜ ∣ ￤ ¦` as `|`",
      "The declaration itself is then read on the raw line, which MUST have the strict form, in ASCII where the form says so.",
      "Every line that mentions `maturité du document`, once folded, MUST be exactly one strict declaration line",
      "two consecutive lines whose join mentions it while neither does alone are refused naming both lines",
      "then a level of the ladder followed by the end of the line, a space, a tab or an ASCII punctuation",
      "Every line whose first letters and digits, once folded and after every leading character that is neither a letter nor a digit (an ordered-list number and a task-list box included), read `CA-<digits>` MUST be a strict criterion bullet",
      "a table row that starts with a `CA-<n>` is refused",
      "Two spellings of one number (`CA-01` and `CA-1`) are one criterion",
      "Every line whose first letters and digits, once folded and after every leading character that is neither a letter nor a digit, read `WP-<digits>`, and which holds a `|`, MUST be a row of the block of that table",
      "the volume line then says `unreadable` for the work packages or the criteria",
      "Faux refusals are accepted",
    ]) {
      expect(text).toContain(sentence);
    }
    for (const stale of [
      "it is never ignored",
      "compatibility forms (NFKC)",
      "HTML entities decoded",
      "HTML tags removed",
      "accents and invisible format characters removed",
      "the control characters other than the tab",
      "optionally followed by a remark that starts after a non-letter",
      "once normalised",
      "after indentation, list, quote or heading markers and emphasis",
      "after `|`, spaces and emphasis",
      "or in a cell of a table row (a line that starts with `|`), is not a definition",
      "a comment or any HTML block",
      "an entity or a decomposed accent in the label",
      "never the quoted one",
      "the quoted level is never taken",
      "hidden when rendered",
      "disagree on where a fence or a comment starts or ends",
      "Fenced code blocks and HTML comments are not read",
      "since a renderer",
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
