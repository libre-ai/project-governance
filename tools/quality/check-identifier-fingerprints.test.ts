import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkTree,
  classifyTracked,
  deliveredConfusables,
  derive,
  deriveEntries,
  type FingerprintData,
  type FingerprintEntry,
  findingCheck,
  fingerprintOfTokens,
  foldWith,
  IDENTIFIER_CLASSES,
  type IdentifierClass,
  loadConfusables,
  parseConfusables,
  parseFingerprintData,
  scanText,
  tallyCounters,
  tokenize,
  tokenizeWith,
} from "./check-identifier-fingerprints";
import { GateReport, renderGateReport } from "./gate-report";

// Every identifier below is synthetic. The real lists are never written in this
// repository; only their fingerprints are, by their owners.

const ROOT = join(import.meta.dir, "..", "..");
const CLASSES = Object.keys(IDENTIFIER_CLASSES) as IdentifierClass[];

function dataOf(entries: readonly FingerprintEntry[]): FingerprintData {
  return { because: "test data", entries, exemptPaths: [] };
}

function derivedData(identifierClass: IdentifierClass, identifier: string): FingerprintData {
  const derived = deriveEntries(identifierClass, [identifier]);
  expect(derived.refused).toEqual([]);
  return dataOf(derived.entries);
}

describe("fingerprintOfTokens", () => {
  test("matches the published SHA-256 test vector for abc", () => {
    // FIPS 180-2, appendix B.1: the expected value comes from the standard.
    expect(fingerprintOfTokens(["abc"])).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("joins the tokens with one space before hashing", () => {
    expect(fingerprintOfTokens(["ab", "c"])).toBe(fingerprintOfTokens(["ab c"]));
    expect(fingerprintOfTokens(["ab", "c"])).not.toBe(fingerprintOfTokens(["abc"]));
  });
});

describe("tokenize", () => {
  test("punctuation, hyphen, dot, slash and underscore separate; columns are 1-based", () => {
    expect(tokenize("Foo_bar.baz/qux-quux, end")).toEqual([
      { token: "foo", column: 1 },
      { token: "bar", column: 5 },
      { token: "baz", column: 9 },
      { token: "qux", column: 13 },
      { token: "quux", column: 17 },
      { token: "end", column: 23 },
    ]);
  });

  test("applies NFKC then lower case, with columns in the original line", () => {
    // U+FF21..U+FF23 are fullwidth A, B, C; U+FB01 is the ligature fi.
    expect(tokenize("\u{FF21}\u{FF22}\u{FF23}-\u{FB01}x Zz")).toEqual([
      { token: "abc", column: 1 },
      { token: "fix", column: 5 },
      { token: "zz", column: 8 },
    ]);
  });

  test("removes a diacritic, decomposed or precomposed (owner decision of 2026-11-17)", () => {
    // e + U+0301 COMBINING ACUTE ACCENT, and U+00E9 precomposed: both read e.
    expect(tokenize("cafe\u{301} x caf\u{E9}")).toEqual([
      { token: "cafe", column: 1 },
      { token: "x", column: 7 },
      { token: "cafe", column: 9 },
    ]);
  });

  test("letters and digits of any script are token characters", () => {
    // U+03B4 and U+03BB have no Latin skeleton, nor their capitals: they stay Greek.
    expect(tokenize("\u{3B4}\u{3BB}9 \u{661}")).toEqual([
      { token: "\u{3B4}\u{3BB}9", column: 1 },
      { token: "\u{661}", column: 5 },
    ]);
  });

  // Each variant below folds the WHOLE line, not piece by piece. Every word is
  // invented. The skeletons come from UTS #39 confusables.txt (lines quoted).

  test("homoglyphs fold to their Latin skeleton, upper-case ones before lower case", () => {
    // 043E ; 006F (Cyrillic o), 0430 ; 0061 (Cyrillic a), 0397 ; 0048 (Greek
    // capital eta), 041D ; 0048 (Cyrillic capital en), 0131 ; 0069 (dotless i).
    expect(tokenize("z\u{43E}rbl\u{430}x \u{397}\u{41D}zz qu\u{131}ntel")).toEqual([
      { token: "zorblax", column: 1 },
      { token: "hhzz", column: 9 },
      { token: "quintel", column: 14 },
    ]);
  });

  test("a final and a medial sigma fold alike, whatever follows the word", () => {
    // Lower case alone gives U+03C2 before a dot and a space, U+03C3 before a dot and a letter.
    const [atEnd] = tokenize("\u{39B}\u{3A3}. y");
    const [beforeLetter] = tokenize("\u{39B}\u{3A3}.\u{3A7}");
    expect(atEnd?.token).toBe(beforeLetter?.token ?? "absent");
    expect(tokenize("\u{3BB}\u{3C2}")).toEqual(tokenize("\u{3BB}\u{3C3}"));
  });

  test("a dotted capital I folds to i and does not split", () => {
    // U+0130 lower-cases to i + U+0307 COMBINING DOT ABOVE; the mark goes.
    expect(tokenize("\u{130}ZORBLAX quintel")).toEqual([
      { token: "izorblax", column: 1 },
      { token: "quintel", column: 10 },
    ]);
  });

  test("conjoining Hangul jamo compose into syllables, columns stay in the original line", () => {
    const syllables = "\u{BDC1}\u{CFC4}"; // an invented two-syllable word
    const jamo = syllables.normalize("NFD");
    expect([...jamo].length).toBe(5);
    expect(tokenize(`${jamo} zz`)).toEqual([
      { token: syllables, column: 1 },
      { token: "zz", column: 7 },
    ]);
  });

  test("default-ignorable characters are removed before the split", () => {
    // U+200B ZERO WIDTH SPACE, U+200D ZERO WIDTH JOINER, U+00AD SOFT HYPHEN.
    for (const ignorable of ["\u{200B}", "\u{200D}", "\u{AD}"]) {
      expect(tokenize(`a zorb${ignorable}laxquintel b`)).toEqual([
        { token: "a", column: 1 },
        { token: "zorblaxquintel", column: 3 },
        { token: "b", column: 19 },
      ]);
    }
  });
});

describe("scanText", () => {
  test("a one-token identifier is found with path, line, column and class", () => {
    const data = derivedData("person", "zzfixturealpha");
    const result = scanText("docs/a.md", "first line\nsee zzfixturealpha here\n", data);
    expect(result.findings).toEqual([{ path: "docs/a.md", line: 2, column: 5, class: "person" }]);
  });

  test("the rendered output names neither the identifier, the line nor the fingerprint", () => {
    const data = derivedData("person", "zzfixturealpha");
    const sourceLine = "owner: zzfixturealpha (on call)";
    const { findings } = scanText("docs/a.md", sourceLine, data);
    expect(findings).toHaveLength(1);
    const report = new GateReport();
    for (const finding of findings) {
      const check = findingCheck(finding);
      report.check(check.item, false, check.note);
    }
    const output = renderGateReport("Identifier fingerprints", report).lines.join("\n");
    expect(output).toContain("Identifier fingerprints: docs/a.md:1:8: person");
    expect(output.toLowerCase()).not.toContain("zzfixturealpha");
    expect(output).not.toContain(sourceLine);
    expect(output).not.toContain(data.entries[0]?.sha256 ?? "no fingerprint");
  });

  test("a three-token host form is found under other separators and another case", () => {
    const data = derivedData("tenant", "zzalpha.zzbeta.zzgamma");
    expect(data.entries[0]?.tokens).toBe(3);
    const found = scanText("x.txt", "url: https://ZZALPHA-zzbeta/ZzGamma/path", data);
    expect(found.findings).toEqual([{ path: "x.txt", line: 1, column: 14, class: "tenant" }]);
  });

  test("a run of tokens never crosses a line end", () => {
    const data = derivedData("tenant", "zzalpha.zzbeta.zzgamma");
    expect(scanText("x.txt", "zzalpha.zzbeta\nzzgamma", data).findings).toEqual([]);
    expect(scanText("x.txt", "zzalpha.zzbeta\r\nzzgamma", data).findings).toEqual([]);
  });

  test("neutralisation: without the entry the same text matches nothing, with it once", () => {
    const text = "contact zzfixturebeta today";
    const data = derivedData("group", "zzfixturebeta");
    const other = derivedData("group", "zzfixtureother");
    expect(scanText("x.txt", text, dataOf(other.entries)).findings).toEqual([]);
    expect(
      scanText("x.txt", text, dataOf([...other.entries, ...data.entries])).findings,
    ).toHaveLength(1);
  });

  test("a line with the marker is not judged and is counted; without it, it matches", () => {
    const data = derivedData("person", "zzfixturealpha");
    const marked = scanText("x.ts", "zzfixturealpha // allow-identifier-fingerprint", data);
    expect(marked).toEqual({ findings: [], markerLines: 1 });
    const unmarked = scanText("x.ts", "zzfixturealpha // a comment", data);
    expect(unmarked.findings).toHaveLength(1);
    expect(unmarked.markerLines).toBe(0);
  });

  test("an identifier glued inside a longer token is not seen (stated limit)", () => {
    const data = derivedData("person", "zzfixturealpha");
    expect(scanText("x.txt", "prezzfixturealphapost", data).findings).toEqual([]);
  });

  test("derivation and scan agree across case, composition and invisible characters", () => {
    const cases: [string, string, string, number][] = [
      // [why, derived from, written in the file, column]
      [
        "final sigma",
        "\u{396}\u{39F}\u{3A1}\u{392}\u{391}\u{39B}\u{39F}\u{3A3}",
        "\u{3B6}\u{3BF}\u{3C1}\u{3B2}\u{3B1}\u{3BB}\u{3BF}\u{3C2}",
        5,
      ],
      ["dotted capital I", "\u{130}ZORBLAXQUINTEL", "i\u{307}zorblaxquintel", 5],
      [
        "Hangul jamo",
        "\u{BDC1}\u{CFC4}\u{D0A4}\u{B8E8}",
        "\u{BDC1}\u{CFC4}\u{D0A4}\u{B8E8}".normalize("NFD"),
        5,
      ],
      ["zero width space", "zorblaxquintel", "zorb\u{200B}laxquintel", 5],
      ["zero width joiner", "zorblaxquintel", "zorblax\u{200D}quintel", 5],
      ["soft hyphen", "zorblaxquintel", "zorbla\u{AD}xquintel", 5],
      ["ignorable in the list", "zorb\u{200B}laxquintel", "zorblaxquintel", 5],
      [
        "final sigma before a dot and a letter",
        "\u{39B}\u{391}\u{39B}\u{39F}\u{3A3}",
        "\u{39B}\u{391}\u{39B}\u{39F}\u{3A3}.\u{3A7}",
        5,
      ],
      ["diaeresis written, not listed", "zorblaxquintel", "z\u{F6}rblaxquintel", 5],
      ["acute listed, not written", "z\u{F3}rblaxquintel", "zorblaxquintel", 5],
      ["Cyrillic o for a Latin o", "zorblaxquintel", "z\u{43E}rblaxquintel", 5],
      ["Greek capital eta for an H", "hzorblaxquintel", "\u{397}ZORBLAXQUINTEL", 5],
      ["Greek iota for an i", "zorblaxquintel", "zorblaxqu\u{3B9}ntel", 5],
      ["Cyrillic small a in the list", "z\u{430}rblaxquintel", "zarblaxquintel", 5],
    ];
    for (const [why, listed, written, column] of cases) {
      const data = derivedData("person", listed);
      expect({ why, findings: scanText("x.txt", `see ${written}.`, data).findings }).toEqual({
        why,
        findings: [{ path: "x.txt", line: 1, column, class: "person" }],
      });
    }
  });

  test("homoglyphs beyond the table are not folded (stated limits)", () => {
    const data = derivedData("person", "zorblaxquintel");
    // U+0585 ARMENIAN SMALL LETTER OH: another script than the table's.
    expect(scanText("x.txt", "z\u{585}rblaxquintel", data).findings).toEqual([]);
    // `rn` for `m`: a skeleton of two letters.
    const twoLetters = derivedData("person", "zormblax");
    expect(scanText("x.txt", "zorrnblax", twoLetters).findings).toEqual([]);
    // ASCII is never mapped to ASCII: a digit one is not an l.
    const ascii = derivedData("person", "zorblax");
    expect(scanText("x.txt", "zorb1ax", ascii).findings).toEqual([]);
  });
});

describe("each class prints its own action", () => {
  for (const identifierClass of CLASSES) {
    test(`${identifierClass}`, () => {
      const data = derivedData(identifierClass, `zzfixture-${identifierClass}`);
      const [finding] = scanText("f.txt", `zzfixture ${identifierClass}`, data).findings;
      expect(finding).toBeDefined();
      if (finding === undefined) return;
      expect(finding.class).toBe(identifierClass);
      expect(findingCheck(finding).note).toBe(
        `${identifierClass} — ${IDENTIFIER_CLASSES[identifierClass]}`,
      );
    });
  }

  test("the five classes are the five of the brief, with five distinct actions", () => {
    expect(CLASSES).toEqual(["tenant", "group", "person", "provider", "reference"]);
    expect(new Set(Object.values(IDENTIFIER_CLASSES)).size).toBe(5);
  });
});

describe("deriveEntries", () => {
  test("refuses an identifier of 3 characters by line number, derives one of 4", () => {
    const derived = deriveEntries("person", ["zzz", "zzzz", "z.z-z", ""]);
    expect(derived.refused).toEqual([1, 3, 4]);
    expect(derived.entries).toEqual([
      { class: "person", tokens: 1, sha256: fingerprintOfTokens(["zzzz"]) },
    ]);
  });

  test("normalises like the scan and yields one entry for a repeated identifier", () => {
    const derived = deriveEntries("tenant", ["ZZAlpha.zzBeta", "zzalpha zzbeta"]);
    expect(derived.refused).toEqual([]);
    expect(derived.entries).toEqual([
      { class: "tenant", tokens: 2, sha256: fingerprintOfTokens(["zzalpha", "zzbeta"]) },
    ]);
  });
});

describe("parseFingerprintData", () => {
  const sha = fingerprintOfTokens(["zzfixturealpha"]);
  const valid = {
    because: "test",
    entries: [{ class: "person", tokens: 1, sha256: sha }],
    exemptPaths: [{ path: "docs/a.md", because: "quoted on purpose" }],
  };

  function reasonOf(value: unknown): string {
    const parsed = parseFingerprintData(typeof value === "string" ? value : JSON.stringify(value));
    expect(parsed.ok).toBe(false);
    return parsed.ok ? "" : parsed.reason;
  }

  test("accepts a well-formed file", () => {
    const parsed = parseFingerprintData(JSON.stringify(valid));
    expect(parsed).toEqual({ ok: true, data: valid as FingerprintData });
  });

  test.each([
    ["invalid JSON", "{", "invalid JSON"],
    ["unknown top-level key", { ...valid, extra: 1 }, "unknown key at the top level"],
    ["empty because", { ...valid, because: " " }, "because is missing or empty"],
    ["empty entries", { ...valid, entries: [] }, "entries is empty"],
    [
      "unknown entry key",
      { ...valid, entries: [{ class: "person", tokens: 1, sha256: sha, note: "x" }] },
      "entries[0]: unknown key",
    ],
    [
      "unknown class",
      { ...valid, entries: [{ class: "zzclass", tokens: 1, sha256: sha }] },
      "entries[0]: unknown class",
    ],
    [
      "tokens zero",
      { ...valid, entries: [{ class: "person", tokens: 0, sha256: sha }] },
      "entries[0]: tokens is not an integer of at least 1",
    ],
    [
      "tokens fractional",
      { ...valid, entries: [{ class: "person", tokens: 1.5, sha256: sha }] },
      "entries[0]: tokens is not an integer of at least 1",
    ],
    [
      "tokens as text",
      { ...valid, entries: [{ class: "person", tokens: "1", sha256: sha }] },
      "entries[0]: tokens is not an integer of at least 1",
    ],
    [
      "upper-case sha256",
      { ...valid, entries: [{ class: "person", tokens: 1, sha256: sha.toUpperCase() }] },
      "entries[0]: sha256 is not 64 lower-case hexadecimal characters",
    ],
    [
      "short sha256",
      { ...valid, entries: [{ class: "person", tokens: 1, sha256: sha.slice(1) }] },
      "entries[0]: sha256 is not 64 lower-case hexadecimal characters",
    ],
    [
      "duplicate",
      {
        ...valid,
        entries: [
          { class: "person", tokens: 1, sha256: sha },
          { class: "tenant", tokens: 1, sha256: sha },
        ],
      },
      "entries[1]: duplicate fingerprint",
    ],
    [
      "exemption without reason",
      { ...valid, exemptPaths: [{ path: "docs/a.md", because: "" }] },
      "exemptPaths[0]: because is missing or empty",
    ],
    [
      "exemption with an unknown key",
      { ...valid, exemptPaths: [{ path: "docs/a.md", because: "x", glob: "*" }] },
      "exemptPaths[0]: unknown key",
    ],
    [
      "exemption with a line break",
      { ...valid, exemptPaths: [{ path: "docs/a.md\nother.md # x", because: "x" }] },
      "exemptPaths[0]: control character",
    ],
  ])("%s is refused", (_name, value, reason) => {
    expect(reasonOf(value)).toBe(reason);
  });

  test("a refusal never echoes the rejected value", () => {
    expect(
      reasonOf({ ...valid, entries: [{ class: "zzfixturealpha", tokens: 1, sha256: sha }] }),
    ).not.toContain("zzfixturealpha");
  });
});

describe("the homoglyph table", () => {
  const sha = "a".repeat(64);
  const valid = {
    because: "test",
    source: { url: "https://example.invalid/confusables.txt", date: "2026-01-01", sha256: sha },
    pairs: [
      { from: "0430", to: "a" },
      { from: "0397", to: "H" },
    ],
  };

  function reasonOf(value: unknown): string {
    const parsed = parseConfusables(typeof value === "string" ? value : JSON.stringify(value));
    expect(parsed.ok).toBe(false);
    return parsed.ok ? "" : parsed.reason;
  }

  test("accepts a well-formed table, a capital acting through its lower case", () => {
    const parsed = parseConfusables(JSON.stringify(valid));
    expect(parsed).toEqual({
      ok: true,
      pairs: 2,
      table: {
        fold: new Map([
          ["\u{430}", "a"],
          ["\u{3B7}", "h"],
        ]),
        own: 1,
        derived: 1,
        shadowed: 0,
      },
    });
  });

  test("a lower-case letter's own pair wins over its capital's, and the count says so", () => {
    // 039D ; 004E (Greek capital nu, N) and 03BD ; 0076 (Greek nu, v).
    const parsed = parseConfusables(
      JSON.stringify({
        ...valid,
        pairs: [
          { from: "039D", to: "N" },
          { from: "03BD", to: "v" },
        ],
      }),
    );
    expect(parsed.ok && parsed.table).toEqual({
      fold: new Map([["\u{3BD}", "v"]]),
      own: 1,
      derived: 0,
      shadowed: 1,
    });
  });

  test.each([
    ["invalid JSON", "{", "invalid JSON"],
    ["unknown top-level key", { ...valid, extra: 1 }, "unknown key at the top level"],
    ["empty because", { ...valid, because: "" }, "because is missing or empty"],
    [
      "short source sha256",
      { ...valid, source: { ...valid.source, sha256: "abc" } },
      "source must be { url, date, sha256 } with a 64-hex sha256",
    ],
    ["empty pairs", { ...valid, pairs: [] }, "pairs is not a non-empty array"],
    [
      "lower-case hexadecimal",
      { ...valid, pairs: [{ from: "03bf", to: "o" }] },
      "pairs[0]: from is not an upper-case hexadecimal code point",
    ],
    [
      "an ASCII source",
      { ...valid, pairs: [{ from: "0031", to: "l" }] },
      "pairs[0]: from is not a letter of the Latin, Greek or Cyrillic blocks",
    ],
    [
      "a source outside the three blocks (Armenian)",
      { ...valid, pairs: [{ from: "0585", to: "o" }] },
      "pairs[0]: from is not a letter of the Latin, Greek or Cyrillic blocks",
    ],
    [
      "a source that is not a letter (multiplication sign)",
      { ...valid, pairs: [{ from: "00D7", to: "x" }] },
      "pairs[0]: from is not a letter of the Latin, Greek or Cyrillic blocks",
    ],
    [
      "a two-letter target",
      { ...valid, pairs: [{ from: "0430", to: "rn" }] },
      "pairs[0]: to is not one ASCII letter",
    ],
    [
      "a digit target",
      { ...valid, pairs: [{ from: "0430", to: "1" }] },
      "pairs[0]: to is not one ASCII letter",
    ],
    [
      "a duplicate source",
      {
        ...valid,
        pairs: [
          { from: "0430", to: "a" },
          { from: "0430", to: "A" },
        ],
      },
      "pairs[1]: duplicate source",
    ],
    [
      "an unknown pair key",
      { ...valid, pairs: [{ from: "0430", to: "a", note: "x" }] },
      "pairs[0] is not an object { from, to }",
    ],
  ])("%s is refused", (_name, value, reason) => {
    expect(reasonOf(value)).toBe(reason);
  });

  test("an absent table is a failure, never an empty table", () => {
    expect(loadConfusables(join(import.meta.dir, "no-such-table.v1.json"))).toEqual({
      ok: false,
      reason: "the homoglyph table is absent or unreadable",
    });
  });

  test("the delivered table parses and carries lines of UTS #39 confusables.txt", () => {
    const delivered = deliveredConfusables();
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;
    // Quoted from confusables.txt: `0430 ; 0061`, `043E ; 006F`, `03BF ; 006F`,
    // `0131 ; 0069`, `0397 ; 0048`, `041D ; 0048`.
    const { fold, own, derived, shadowed } = delivered.table;
    expect(fold.get("\u{430}")).toBe("a");
    expect(fold.get("\u{43E}")).toBe("o");
    expect(fold.get("\u{3BF}")).toBe("o");
    expect(fold.get("\u{131}")).toBe("i");
    // Through their lower case, U+03B7 and U+043D.
    expect(fold.get("\u{3B7}")).toBe("h");
    expect(fold.get("\u{43D}")).toBe("h");
    expect(delivered.pairs).toBe(own + derived + shadowed);
    expect(fold.size).toBe(own + derived);
  });

  test("foldWith lower-cases first, then applies the given table", () => {
    const table = { fold: new Map([["\u{430}", "a"]]), own: 1, derived: 0, shadowed: 0 };
    // U+0410 is not in this table, but its lower case U+0430 is.
    expect(foldWith("\u{430}\u{410}Z", table)).toBe("aaz");
    expect(tokenizeWith("\u{410}\u{430} x", table)).toEqual([
      { token: "aa", column: 1 },
      { token: "x", column: 4 },
    ]);
  });

  test("the gate fails, naming the table, and reads nothing else when the table is invalid", () => {
    const report = new GateReport();
    checkTree(report, { ok: false, reason: "the homoglyph table is absent or unreadable" });
    const rendered = renderGateReport("Identifier fingerprints", report);
    expect(rendered.lines.join("\n")).toContain(
      "tools/quality/identifier-confusables.v1.json: the homoglyph table is absent or unreadable",
    );
    expect(rendered.lines.join("\n")).not.toContain("fingerprint(s) read");
  });

  test("--derive refuses to derive without a valid table, from a list it would accept", () => {
    // A readable list outside every repository: with the delivered table it derives.
    const outside = mkdtempSync(join(tmpdir(), "identifier-fingerprints-derive-"));
    try {
      const list = join(outside, "list.txt");
      writeFileSync(list, "zorblaxquintel\n");
      expect(derive("person", list, deliveredConfusables())).toBe(0);
      const refused = derive("person", list, {
        ok: false,
        reason: "the homoglyph table is absent or unreadable",
      });
      expect(refused).toBe(1);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("classifyTracked", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const files: Record<string, Uint8Array> = {
    "a.txt": bytes("zzfixturealpha\n"),
    "b.bin": new Uint8Array([0x7a, 0x00, 0x7a]),
    "c.txt": bytes("exempt"),
  };
  const read: string[] = [];
  const reader = {
    file: (path: string) => {
      read.push(path);
      return files[path] ?? null;
    },
    link: (path: string) => (path === "l" ? "elsewhere.txt" : null),
  };

  test("puts each entry in exactly one counter and reads only what it must", () => {
    const classified = classifyTracked(
      [
        { mode: "100644", path: "a.txt" },
        { mode: "100755", path: "b.bin" },
        { mode: "100644", path: "c.txt" },
        { mode: "120000", path: "l" },
        { mode: "160000", path: "sub" },
        { mode: "100644", path: "gone.txt" },
      ],
      ["c.txt"],
      reader,
    );
    expect(classified).toEqual([
      { path: "a.txt", counter: "examined", text: "zzfixturealpha\n" },
      { path: "b.bin", counter: "binary" },
      { path: "c.txt", counter: "exempt" },
      { path: "l", counter: "symlink", text: "elsewhere.txt" },
      { path: "sub", counter: "other" },
      { path: "gone.txt", counter: "unreadable" },
    ]);
    // The exempt file and the gitlink are never read.
    expect(read).toEqual(["a.txt", "b.bin", "gone.txt"]);
  });

  test("a file holding a NUL byte is binary even if it carries a listed identifier", () => {
    const [entry] = classifyTracked([{ mode: "100644", path: "x" }], [], {
      file: () => bytes("zzfixturealpha\u{0}"),
      link: () => null,
    });
    expect(entry).toEqual({ path: "x", counter: "binary" });
  });
});

describe("tallyCounters", () => {
  test("the five counters sum to the classified entries", () => {
    const tally = tallyCounters([
      { path: "a", counter: "examined", text: "" },
      { path: "b", counter: "exempt" },
      { path: "c", counter: "binary" },
      { path: "d", counter: "symlink", text: "" },
      { path: "e", counter: "other" },
      { path: "f", counter: "other" },
    ]);
    expect(tally).toEqual({
      counts: { examined: 1, exempt: 1, binary: 1, symlink: 1, other: 2 },
      summed: 6,
      sums: true,
    });
  });

  test("one unreadable entry breaks the sum", () => {
    const tally = tallyCounters([
      { path: "a", counter: "examined", text: "" },
      { path: "b", counter: "unreadable" },
    ]);
    expect(tally.summed).toBe(1);
    expect(tally.sums).toBe(false);
  });
});

describe("delivered data and wiring", () => {
  test("the delivered data file parses and holds the synthetic sentinel", () => {
    const text = readFileSync(join(import.meta.dir, "identifier-fingerprints.v1.json"), "utf8");
    const parsed = parseFingerprintData(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Composed at run time, so no source line carries the sentinel's token.
    const sentinel = ["zz", "sentinel", "fixture"].join("");
    expect(parsed.data.entries).toContainEqual({
      class: "person",
      tokens: 1,
      sha256: fingerprintOfTokens([sentinel]),
    });
    // Regenerated with the folding fingerprint: derivation gives the same entry.
    expect(parsed.data.entries).toEqual(deriveEntries("person", [sentinel]).entries);
  });

  test("the module is in no `check` chain and no workflow", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["check:identifier-fingerprints"]).toBe(
      "bun run check:bun:runtime && bun tools/quality/check-identifier-fingerprints.ts",
    );
    expect(manifest.scripts.check).toBeDefined();
    expect(manifest.scripts.check).not.toContain("identifier-fingerprints");

    const workflows = join(ROOT, ".github", "workflows");
    const files = readdirSync(workflows, { recursive: true, encoding: "utf8" })
      .map((name) => join(workflows, name))
      .filter((path) => statSync(path).isFile());
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      expect(readFileSync(path, "utf8")).not.toContain("identifier-fingerprints");
    }
  });
});
