import { describe, expect, test } from "bun:test";
import {
  canonical,
  disagreementWithBun,
  parseTomlDocument,
  quoteDates,
  type TomlNode,
  toPlain,
} from "./toml-document";

function plain(text: string): unknown {
  return toPlain(parseTomlDocument(text).root);
}

function at(node: TomlNode | undefined, ...path: (string | number)[]): TomlNode | undefined {
  let current = node;
  for (const step of path) {
    if (current === undefined) return undefined;
    if (typeof step === "number")
      current = current.type === "array" ? current.items[step] : undefined;
    else current = current.type === "table" ? current.entries.get(step) : undefined;
  }
  return current;
}

describe("parseTomlDocument — values", () => {
  test("reads tables, arrays of tables, dotted keys and inline tables", () => {
    const text =
      '[a.b]\nc = 1\nd.e = "x"\n[[t]]\nk = 1\n[[t]]\nk = 2\n[t.sub]\nm = { n = true, o.p = [1, 2] }\n';
    expect(plain(text)).toEqual({
      a: { b: { c: 1, d: { e: "x" } } },
      t: [{ k: 1 }, { k: 2, sub: { m: { n: true, o: { p: [1, 2] } } } }],
    });
  });

  test("decodes the four string forms", () => {
    const text =
      'a = "q\\"\\u00e9\\n"\nb = \'c:\\\\x\'\nc = """\nline\\\n   joined"""\nd = \'\'\'\nraw\\n\'\'\'\n';
    expect(plain(text)).toEqual({ a: 'q"é\n', b: "c:\\\\x", c: "linejoined", d: "raw\\n" });
  });

  test("keeps dates as their source text and reports their spans", () => {
    const text =
      "a = 2026-09-30\nb = 2026-09-30T00:00:00Z\nc = 1979-05-27 07:32:00\nd = 07:32:00\n";
    const document = parseTomlDocument(text);
    expect(toPlain(document.root)).toEqual({
      a: "2026-09-30",
      b: "2026-09-30T00:00:00Z",
      c: "1979-05-27 07:32:00",
      d: "07:32:00",
    });
    expect(quoteDates(text, document.dateSpans)).toBe(
      'a = "2026-09-30"\nb = "2026-09-30T00:00:00Z"\nc = "1979-05-27 07:32:00"\nd = "07:32:00"\n',
    );
  });

  test("reads numbers in every TOML notation", () => {
    expect(plain("a = 1_000\nb = 0x1F\nc = -2.5e3\nd = inf\ne = +0\n")).toEqual({
      a: 1000,
      b: 31,
      c: -2500,
      d: Infinity,
      e: 0,
    });
  });
});

describe("parseTomlDocument — positions and comments", () => {
  test("every array item carries its own line; comments are keyed by line", () => {
    const text = '# head\n[advisories]\nignore = [\n  "A", # first\n  { id = "B" }, # second\n]\n';
    const document = parseTomlDocument(text);
    const ignore = at(document.root, "advisories", "ignore");
    expect(ignore?.type === "array" ? ignore.items.map((item) => item.line) : []).toEqual([4, 5]);
    expect(document.comments.get(1)).toBe(" head");
    expect(document.comments.get(4)).toBe(" first");
    expect(document.comments.get(5)).toBe(" second");
  });

  test("a decoy inside a multi-line string is string content, not a table nor a comment", () => {
    // Review case c38: the PR #56 scanner took the decoy for the list.
    const text =
      "[[bans.deny]]\nreason = '''\n[advisories]\nignore = [\"X\"] # decoy\n'''\n[advisories]\nignore = [\"Y\"]\n";
    const document = parseTomlDocument(text);
    expect(toPlain(at(document.root, "advisories", "ignore") as TomlNode)).toEqual(["Y"]);
    expect(at(document.root, "advisories", "ignore", 0)?.line).toBe(7);
    expect(document.comments.has(4)).toBe(false);
  });

  test("an array-of-tables item's line is its header", () => {
    const document = parseTomlDocument('x = 1\n[["IgnoredVulns"]]\nid = "a"\n');
    expect(at(document.root, "IgnoredVulns", 0)?.line).toBe(2);
  });
});

describe("parseTomlDocument — refusals", () => {
  for (const [text, line] of [
    ["a = 1\na = 2\n", 2],
    ["[a]\n[a]\n", 2],
    ['a = "x\n', 1],
    ["a = [1, 2\n", 2],
    ["a = 1 b = 2\n", 1],
    ["nonsense\n", 1],
    ['a = """open\n', 2],
    ["a = { b = 1 }\n[a]\n", 2],
    ['a = "\\q"\n', 1],
  ] as const) {
    test(`refuses ${JSON.stringify(text)} at line ${line}`, () => {
      expect(() => parseTomlDocument(text)).toThrow(`line ${line}:`);
    });
  }
});

describe("disagreementWithBun", () => {
  test("the fleet base deny.toml is read the same by both parsers", async () => {
    const text = await Bun.file(new URL("../../deny.toml", import.meta.url)).text();
    expect(disagreementWithBun(text, parseTomlDocument(text))).toBeNull();
  });

  test("a bare date is quoted for Bun, so both read it", () => {
    const text = '[[IgnoredVulns]]\nid = "a"\nignoreUntil = 2026-12-31\n';
    expect(disagreementWithBun(text, parseTomlDocument(text))).toBeNull();
  });

  test("a value tree the positional reader got wrong is a disagreement", () => {
    const text = 'a = ["X"]\n';
    const document = parseTomlDocument(text);
    const array = document.root.entries.get("a");
    if (array?.type === "array") array.items.length = 0;
    expect(disagreementWithBun(text, document)).toContain("different values");
  });

  test("canonical sorts keys and normalises Bun's multi-line string quirks", () => {
    expect(canonical({ b: 1, a: [true, "\nx\r\ny"] })).toBe(canonical({ a: [true, "x\ny"], b: 1 }));
  });
});
