import { describe, expect, test } from "bun:test";

import { findUnreadableCharacter } from "./yaml-text-guard";

// Characters are built from code points: a literal NUL, BOM or line separator in this source
// would be as invisible to a reviewer as it is to the parser the guard protects.
const char = (codePoint: number): string => String.fromCodePoint(codePoint);

describe("findUnreadableCharacter: refused characters", () => {
  const REFUSED: readonly (readonly [string, number, string])[] = [
    ["NUL", 0x0000, "U+0000"],
    ["a C0 control (SOH)", 0x0001, "U+0001"],
    ["a C0 control (BS)", 0x0008, "U+0008"],
    ["a tab", 0x0009, "U+0009"],
    ["a vertical tab", 0x000b, "U+000B"],
    ["a form feed", 0x000c, "U+000C"],
    ["a bare carriage return", 0x000d, "U+000D"],
    ["a C0 control (ESC)", 0x001b, "U+001B"],
    ["a C0 control (US)", 0x001f, "U+001F"],
    ["DEL", 0x007f, "U+007F"],
    ["the first C1 control", 0x0080, "U+0080"],
    ["the next-line control", 0x0085, "U+0085"],
    ["the last C1 control", 0x009f, "U+009F"],
    ["a no-break space", 0x00a0, "U+00A0"],
    ["the line separator", 0x2028, "U+2028"],
    ["the paragraph separator", 0x2029, "U+2029"],
    ["a byte order mark", 0xfeff, "U+FEFF"],
    ["U+FFFE", 0xfffe, "U+FFFE"],
    ["U+FFFF", 0xffff, "U+FFFF"],
    ["an unpaired high surrogate", 0xd800, "U+D800"],
    ["an unpaired low surrogate", 0xdc00, "U+DC00"],
  ];
  for (const [name, codePoint, expected] of REFUSED) {
    test(`${name} is returned with its code point`, () => {
      expect(findUnreadableCharacter(`ab${char(codePoint)}cd`)).toEqual({
        line: 1,
        codePoint: expected,
      });
    });
  }

  test("an unpaired surrogate next to a valid pair is still found", () => {
    const text = `${char(0x1f600)}${char(0xd800)}x`;
    expect(findUnreadableCharacter(text)).toEqual({ line: 1, codePoint: "U+D800" });
  });

  test("the first offender is returned", () => {
    const text = `a${char(1)}b${char(0)}`;
    expect(findUnreadableCharacter(text)).toEqual({ line: 1, codePoint: "U+0001" });
  });
});

describe("findUnreadableCharacter: line numbers", () => {
  test("the line is 1-based", () => {
    expect(findUnreadableCharacter(`a\nb${char(0)}`)).toEqual({ line: 2, codePoint: "U+0000" });
  });

  test("CRLF is one newline, so lines stay right after it", () => {
    expect(findUnreadableCharacter(`a\r\nb\r\nc${char(1)}`)).toEqual({
      line: 3,
      codePoint: "U+0001",
    });
  });

  test("a bare CR next to a CRLF is still refused", () => {
    expect(findUnreadableCharacter("a\r\nb\rc")).toEqual({ line: 2, codePoint: "U+000D" });
  });
});

describe("findUnreadableCharacter: accepted text", () => {
  test("the empty string passes", () => {
    expect(findUnreadableCharacter("")).toBeNull();
  });

  test("ASCII lines, with LF and CRLF, pass", () => {
    expect(findUnreadableCharacter("name: Idea\nbody:\n  - type: input\n")).toBeNull();
    expect(findUnreadableCharacter("name: Idea\r\nbody:\r\n")).toBeNull();
  });

  test("French accented text passes", () => {
    const text =
      "Résumé : où l'œuvre, à côté de la façon « française », ça être échoué. Ève, Noël, Çà et là.\n";
    expect(findUnreadableCharacter(text.repeat(50))).toBeNull();
  });

  test("an em dash, an ellipsis and an astral character pass", () => {
    expect(
      findUnreadableCharacter(`a ${char(0x2014)} b${char(0x2026)} ${char(0x1f600)}`),
    ).toBeNull();
  });

  test("the edges of the allowed class pass", () => {
    const edges: readonly number[] = [
      0x20, 0x7e, 0xa1, 0x2027, 0x202a, 0xd7ff, 0xe000, 0xfefe, 0xff00, 0xfffd, 0x10000, 0x10ffff,
    ];
    for (const edge of edges) {
      expect(findUnreadableCharacter(`a${char(edge)}b`)).toBeNull();
    }
  });
});
