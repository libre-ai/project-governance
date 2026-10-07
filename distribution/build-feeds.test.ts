import { describe, expect, test } from "bun:test";
import {
  buildFeed,
  collectEvents,
  escapeXml,
  parseGateLog,
  renderAtom,
  renderChangelog,
  renderJsonFeed,
} from "./build-feeds";

// The feeds are published machine artifacts: their exact byte format is
// locked by golden fixtures, and the committed real feeds must always match
// a fresh regeneration — so `bun test` alone catches evidence/feed drift,
// mirroring ecosystem/build-index.test.ts.

const fixtureEvidenceUrl = new URL("fixtures/evidence-feed/evidence/", import.meta.url);
const expectedUrl = new URL("fixtures/evidence-feed/expected/", import.meta.url);
const realEvidenceUrl = new URL("evidence/", import.meta.url);
const committedFeedsUrl = new URL("feeds/", import.meta.url);

// ---------------------------------------------------------------------------
// Minimal strict XML parser, deliberately independent from the generator
// (which only concatenates strings): a neutral client that rejects unbalanced
// tags, unquoted attributes, raw `<`/`&` and unknown entities. Validating the
// Atom output with the very code that produced it would prove nothing.
// ---------------------------------------------------------------------------

interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITY = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;
const NAME = /^[A-Za-z_][\w:.-]*/;

function parseXml(xml: string): XmlElement {
  let pos = 0;
  if (xml.startsWith("<?xml")) {
    const end = xml.indexOf("?>");
    if (end === -1) throw new Error("unterminated XML prolog");
    pos = end + 2;
  }
  const skipWhitespace = (): void => {
    while (pos < xml.length && /\s/.test(xml[pos] ?? "")) pos += 1;
  };

  function parseElement(): XmlElement {
    if (xml[pos] !== "<") throw new Error(`expected '<' at offset ${pos}`);
    pos += 1;
    const nameMatch = NAME.exec(xml.slice(pos));
    if (nameMatch === null) throw new Error(`invalid element name at offset ${pos}`);
    const name = nameMatch[0];
    pos += name.length;
    const attributes: Record<string, string> = {};
    for (;;) {
      skipWhitespace();
      if (xml.startsWith("/>", pos)) {
        pos += 2;
        return { name, attributes, children: [], text: "" };
      }
      if (xml[pos] === ">") {
        pos += 1;
        break;
      }
      const attrMatch = NAME.exec(xml.slice(pos));
      if (attrMatch === null) throw new Error(`invalid attribute name at offset ${pos}`);
      pos += attrMatch[0].length;
      if (xml[pos] !== "=") throw new Error(`expected '=' at offset ${pos}`);
      pos += 1;
      const quote = xml[pos];
      if (quote !== '"' && quote !== "'") {
        throw new Error(`unquoted attribute value at offset ${pos}`);
      }
      pos += 1;
      const start = pos;
      while (pos < xml.length && xml[pos] !== quote) {
        if (xml[pos] === "<") throw new Error(`raw '<' in attribute value at offset ${pos}`);
        if (xml[pos] === "&") {
          const entity = ENTITY.exec(xml.slice(pos));
          if (entity === null) throw new Error(`invalid entity in attribute at offset ${pos}`);
          pos += entity[0].length;
          continue;
        }
        pos += 1;
      }
      if (pos >= xml.length) throw new Error("unterminated attribute value");
      attributes[attrMatch[0]] = xml.slice(start, pos);
      pos += 1;
    }
    const children: XmlElement[] = [];
    let text = "";
    for (;;) {
      if (pos >= xml.length) throw new Error(`unterminated element <${name}>`);
      if (xml.startsWith("</", pos)) {
        pos += 2;
        if (!xml.startsWith(name, pos)) throw new Error(`mismatched closing tag for <${name}>`);
        pos += name.length;
        skipWhitespace();
        if (xml[pos] !== ">") throw new Error(`malformed closing tag for <${name}>`);
        pos += 1;
        return { name, attributes, children, text };
      }
      const char = xml[pos];
      if (char === "<") {
        children.push(parseElement());
      } else if (char === "&") {
        const entity = ENTITY.exec(xml.slice(pos));
        if (entity === null) throw new Error(`invalid entity at offset ${pos}`);
        text += entity[0];
        pos += entity[0].length;
      } else {
        text += char;
        pos += 1;
      }
    }
  }

  skipWhitespace();
  const root = parseElement();
  if (xml.slice(pos).trim().length > 0) throw new Error("content after the root element");
  return root;
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

describe("buildFeed on the golden fixture", () => {
  test("renders the changelog byte-for-byte", async () => {
    const feed = buildFeed(await collectEvents(fixtureEvidenceUrl));
    const golden = await Bun.file(new URL("changelog.md", expectedUrl)).text();
    expect(renderChangelog(feed)).toBe(golden);
  });

  test("renders the JSON feed byte-for-byte", async () => {
    const feed = buildFeed(await collectEvents(fixtureEvidenceUrl));
    const golden = await Bun.file(new URL("evidence.json", expectedUrl)).text();
    expect(renderJsonFeed(feed)).toBe(golden);
  });

  test("renders the Atom feed byte-for-byte", async () => {
    const feed = buildFeed(await collectEvents(fixtureEvidenceUrl));
    const golden = await Bun.file(new URL("evidence.atom.xml", expectedUrl)).text();
    expect(renderAtom(feed)).toBe(golden);
  });

  test("two runs produce identical bytes for all three surfaces", async () => {
    const first = buildFeed(await collectEvents(fixtureEvidenceUrl));
    const second = buildFeed(await collectEvents(fixtureEvidenceUrl));
    expect(renderChangelog(first)).toBe(renderChangelog(second));
    expect(renderJsonFeed(first)).toBe(renderJsonFeed(second));
    expect(renderAtom(first)).toBe(renderAtom(second));
  });

  test("sorts events newest first across all sources", async () => {
    const feed = buildFeed(await collectEvents(fixtureEvidenceUrl));
    expect(feed.events.map((event) => event.type)).toEqual([
      "gate",
      "gate",
      "gate",
      "sovereignty",
      "adoption",
      "coverage",
    ]);
    const dates = feed.events.map((event) => event.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  test("a date range keeps the first day as date and the raw cell alongside", async () => {
    const feed = buildFeed(await collectEvents(fixtureEvidenceUrl));
    const ranged = feed.events.find((event) => event.date_raw !== undefined);
    expect(ranged?.date).toBe("2026-01-11");
    expect(ranged?.date_raw).toBe("2026-01-11/12");
  });

  test("an unparsable log row becomes a minimal gate event, never an invention", async () => {
    const feed = buildFeed(await collectEvents(fixtureEvidenceUrl));
    const unparsed = feed.events.find((event) => event.status === "unparsed");
    expect(unparsed?.type).toBe("gate");
    expect(unparsed?.date).toBe("2026-01-13");
    expect(unparsed?.reference).toBe("| 2026-01-13 ligne incomplète sans les quatre cellules |");
  });

  test("a failed sovereignty check fails the whole report status", async () => {
    const feed = buildFeed(await collectEvents(fixtureEvidenceUrl));
    const sovereignty = feed.events.find((event) => event.type === "sovereignty");
    expect(sovereignty?.status).toBe("fail");
  });
});

describe("Atom validity through the independent parser", () => {
  test("fixture Atom is well-formed and structurally an Atom 1.0 feed", async () => {
    const feed = buildFeed(await collectEvents(fixtureEvidenceUrl));
    const root = parseXml(renderAtom(feed));
    expect(root.name).toBe("feed");
    expect(root.attributes.xmlns).toBe("http://www.w3.org/2005/Atom");
    const names = root.children.map((child) => child.name);
    for (const required of ["id", "title", "updated", "author"]) {
      expect(names).toContain(required);
    }
    const entries = root.children.filter((child) => child.name === "entry");
    expect(entries.length).toBe(feed.events.length);
    for (const entry of entries) {
      const byName = new Map(entry.children.map((child) => [child.name, child]));
      expect(byName.get("id")?.text.startsWith("tag:")).toBe(true);
      expect(byName.get("title")).toBeDefined();
      expect(byName.get("updated")?.text).toMatch(RFC3339);
      expect(byName.get("link")?.attributes.href).toMatch(
        /^https:\/\/github\.com\/libre-ai\/libre-ai\/blob\/main\//,
      );
    }
  });

  test("committed Atom is well-formed for the same neutral parser", async () => {
    const root = parseXml(await Bun.file(new URL("evidence.atom.xml", committedFeedsUrl)).text());
    expect(root.name).toBe("feed");
    expect(root.children.filter((child) => child.name === "entry").length).toBeGreaterThan(0);
  });

  test("XML-hostile characters survive the whole pipeline escaped", async () => {
    const feed = buildFeed(await collectEvents(fixtureEvidenceUrl));
    const atom = renderAtom(feed);
    expect(atom).toContain("&amp; &lt;chevrons&gt; &quot;guillemets&quot; &apos;apostrophe&apos;");
    expect(atom).not.toContain("<chevrons>");
  });
});

describe("escapeXml", () => {
  test("escapes the five predefined entities and nothing else", () => {
    expect(escapeXml("a&b<c>d\"e'f — é")).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f — é");
  });
});

describe("fail-closed guards", () => {
  test("rejects a gate row without any ISO date", () => {
    expect(() => parseGateLog("| pas de date | gate | verdict | ref |")).toThrow(
      "row without an ISO 8601 date",
    );
  });

  test("rejects duplicate event ids", () => {
    const row = "| 2026-01-01 | G-Z — même gate | ACCEPTÉ | PR #9 |";
    const events = parseGateLog(`${row}\n${row}`);
    expect(() => buildFeed(events)).toThrow("duplicate event id");
  });

  test("refuses to publish an empty Atom feed", () => {
    expect(() => renderAtom(buildFeed([]))).toThrow("refusing to publish an empty feed");
  });
});

describe("committed feeds", () => {
  test("match a fresh regeneration from the evidence sources", async () => {
    const feed = buildFeed(await collectEvents(realEvidenceUrl));
    expect(renderChangelog(feed)).toBe(
      await Bun.file(new URL("changelog.md", committedFeedsUrl)).text(),
    );
    expect(renderJsonFeed(feed)).toBe(
      await Bun.file(new URL("evidence.json", committedFeedsUrl)).text(),
    );
    expect(renderAtom(feed)).toBe(
      await Bun.file(new URL("evidence.atom.xml", committedFeedsUrl)).text(),
    );
  });
});
