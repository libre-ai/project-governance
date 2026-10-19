import { describe, expect, test } from "bun:test";
import {
  atLeast,
  MATURITY_LADDER,
  type MaturityLevel,
  parseCriteria,
  parseWorkPackages,
  readDocumentMaturity,
} from "./prd-model";

const TABLE_HEADER =
  "| WP | CA-n couverts | Périmètre (chemins, globs) | Vérification (commande) | Porte anticipée |";
const TABLE_RULE = "| --- | --- | --- | --- | --- |";

function table(...rows: string[]): string {
  return [TABLE_HEADER, TABLE_RULE, ...rows].join("\n");
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
    const markdown = ["Maturité : prototype", "Maturité du document : proposition", ""].join("\n");
    expect(readDocumentMaturity(markdown)).toBe("proposition");
  });

  test('"Maturité :" alone yields null (pilot PRD case)', () => {
    expect(readDocumentMaturity("Maturité : industrialisation\n")).toBeNull();
  });

  test("tolerates bullets, bold markers and a trailing remark", () => {
    expect(
      readDocumentMaturity("- **Maturité du document :** décision (arbitrage du 2026-10-19)\n"),
    ).toBe("décision");
  });

  test("prefers the longest level name", () => {
    expect(readDocumentMaturity("Maturité du document : mise en service\n")).toBe(
      "mise en service",
    );
  });

  test("an unknown level, or two lines that disagree, yield null", () => {
    expect(readDocumentMaturity("Maturité du document : excellente\n")).toBeNull();
    expect(
      readDocumentMaturity("Maturité du document : décision\nMaturité du document : prototype\n"),
    ).toBeNull();
  });

  test("a declaration inside a fenced block or an HTML comment is ignored", () => {
    expect(readDocumentMaturity("```\nMaturité du document : décision\n```\n")).toBeNull();
    expect(readDocumentMaturity("<!-- Maturité du document : décision -->\n")).toBeNull();
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
