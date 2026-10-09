// A TOML reader that keeps what a TOML parser throws away: line positions and
// comments.
//
// Why a second parser when Bun ships `Bun.TOML`: the advisory-waiver gate reads
// its metadata from comments (`# why; expires=...; ref=...`) and reports every
// defect at a line, and `Bun.TOML.parse` returns neither. The first version of
// the gate (PR #56) read ignore lists with a line scanner instead; the
// 2026-10-09 review showed a scanner that does not know where a multi-line
// string starts and ends takes a decoy `ignore = [...]` written inside
// `'''...'''` for the real list. A reader that tokenises the whole document
// cannot be fooled that way: a string is a string wherever it sits.
//
// It is not trusted alone. `parseTomlDocument` returns the token spans of bare
// dates so the caller can quote them and hand the same text to `Bun.TOML`
// (which rejects bare TOML dates — measured on 1.4.0-canary.1), then compare
// the two value trees. Two independent parsers that disagree on a document
// mean one of them is blind to something; the gate treats that as unreadable.
//
// Scope: TOML 1.0 values, plus the TOML 1.1 relaxations Bun accepts (newlines
// and a trailing comma inside an inline table, `\e` and `\xHH` escapes). It
// refuses what it does not understand instead of guessing.

export type TomlNode =
  | { readonly type: "string"; readonly value: string; readonly line: number }
  | { readonly type: "integer" | "float"; readonly value: number; readonly line: number }
  | { readonly type: "boolean"; readonly value: boolean; readonly line: number }
  | { readonly type: "datetime"; readonly value: string; readonly line: number }
  | TomlArray
  | TomlTable;

export interface TomlArray {
  readonly type: "array";
  readonly items: TomlNode[];
  readonly line: number;
  /** True for `[[header]]` arrays: each item is a table whose line is its header. */
  readonly ofTables: boolean;
}

export interface TomlTable {
  readonly type: "table";
  readonly entries: Map<string, TomlNode>;
  /** The line of the key that introduced each entry (header line for a table). */
  readonly keyLines: Map<string, number>;
  readonly line: number;
  /** How the table came to exist; an `implicit` table may still be declared by a header. */
  origin: "root" | "header" | "implicit" | "dotted" | "inline" | "array-item";
}

export interface TomlDocument {
  readonly root: TomlTable;
  /** Comment text (after the `#`) by 1-based line. Only real comments, never string content. */
  readonly comments: ReadonlyMap<number, string>;
  /** Offsets [start, end) of every bare date/time value, for quoting before `Bun.TOML`. */
  readonly dateSpans: readonly (readonly [number, number])[];
}

export class TomlSyntaxError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`line ${line}: ${message}`);
  }
}

const BARE_KEY = /[A-Za-z0-9_-]/;
const DATE_TIME =
  /^(?:\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/;
const INTEGER = /^[+-]?(?:0|[1-9](?:_?\d)*)$/;
const PREFIXED_INTEGER =
  /^0(?:x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|o[0-7](?:_?[0-7])*|b[01](?:_?[01])*)$/;
const FLOAT = /^[+-]?(?:(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?|inf|nan)$/;

export function parseTomlDocument(text: string): TomlDocument {
  return new Parser(text).document();
}

/** Plain JS value of a node, dates as their source text: the shape `Bun.TOML` returns once dates are quoted. */
export function toPlain(node: TomlNode): unknown {
  switch (node.type) {
    case "array":
      return node.items.map(toPlain);
    case "table": {
      const out: Record<string, unknown> = {};
      for (const [key, value] of node.entries) out[key] = toPlain(value);
      return out;
    }
    default:
      return node.value;
  }
}

/** The text with every bare date quoted, so a parser that rejects bare dates reads the same document. */
export function quoteDates(text: string, spans: readonly (readonly [number, number])[]): string {
  let out = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    out += `${text.slice(cursor, start)}"${text.slice(start, end)}"`;
    cursor = end;
  }
  return out + text.slice(cursor);
}

/** Canonical JSON with sorted keys, to compare two value trees. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  // Bun 1.4.0-canary.1 keeps the newline that immediately follows an opening
  // `"""`/`'''` (TOML 1.0 trims it) and keeps CRLF inside a multi-line string
  // (measured 2026-10-09). Neither changes what a waiver says, so both sides
  // are normalised rather than turning every multi-line reason red.
  if (typeof value === "string") {
    return JSON.stringify(value.replaceAll("\r\n", "\n").replace(/^\n/, ""));
  }
  return JSON.stringify(value);
}

/**
 * Cross-check against `Bun.TOML`: null when both parsers read the same values,
 * otherwise the reason they do not.
 */
export function disagreementWithBun(text: string, document: TomlDocument): string | null {
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(quoteDates(text, document.dateSpans));
  } catch (error) {
    return `Bun.TOML refuses it: ${(error as Error).message.split("\n")[0]}`;
  }
  if (canonical(parsed) !== canonical(toPlain(document.root))) {
    return "Bun.TOML and the positional reader return different values; one of them is blind to part of the document";
  }
  return null;
}

class Parser {
  private index = 0;
  private line = 1;
  private readonly comments = new Map<number, string>();
  private readonly dateSpans: [number, number][] = [];
  private readonly root: TomlTable = newTable(1, "root");
  /** Tables fully defined by a header or a value; they cannot be reopened. */
  private readonly closed = new Set<TomlTable>();

  constructor(private readonly text: string) {}

  document(): TomlDocument {
    let current = this.root;
    while (true) {
      this.skipBlankAndComments();
      if (this.index >= this.text.length) break;
      if (this.peek() === "[") {
        current = this.header();
      } else {
        this.keyValue(current);
      }
      this.endOfLine();
    }
    return { root: this.root, comments: this.comments, dateSpans: this.dateSpans };
  }

  // ---------------------------------------------------------------- characters

  private peek(offset = 0): string {
    return this.text[this.index + offset] ?? "";
  }

  private fail(message: string): never {
    throw new TomlSyntaxError(this.line, message);
  }

  private advance(): string {
    const char = this.text[this.index] ?? "";
    this.index += 1;
    if (char === "\n") this.line += 1;
    return char;
  }

  private skipSpaces() {
    while (this.peek() === " " || this.peek() === "\t") this.index += 1;
  }

  private comment() {
    if (this.peek() !== "#") return;
    const start = this.index + 1;
    while (this.index < this.text.length && this.peek() !== "\n") {
      const code = this.text.charCodeAt(this.index);
      if ((code < 0x20 && code !== 0x09 && code !== 0x0d) || code === 0x7f) {
        this.fail("control character in a comment");
      }
      this.index += 1;
    }
    this.comments.set(this.line, this.text.slice(start, this.index).replace(/\r$/, ""));
  }

  private newline(): boolean {
    if (this.peek() === "\n") {
      this.advance();
      return true;
    }
    if (this.peek() === "\r" && this.peek(1) === "\n") {
      this.index += 1;
      this.advance();
      return true;
    }
    return false;
  }

  private skipBlankAndComments() {
    while (this.index < this.text.length) {
      this.skipSpaces();
      this.comment();
      if (!this.newline()) return;
    }
  }

  /** Inside arrays (and TOML 1.1 inline tables): whitespace, newlines and comments. */
  private skipInsideBrackets() {
    while (this.index < this.text.length) {
      this.skipSpaces();
      this.comment();
      if (!this.newline()) return;
    }
  }

  private endOfLine() {
    this.skipSpaces();
    this.comment();
    if (this.index >= this.text.length) return;
    if (!this.newline()) this.fail(`unexpected '${this.peek()}' after a statement`);
  }

  // ---------------------------------------------------------------- keys

  private simpleKey(): string {
    const char = this.peek();
    if (char === '"') {
      if (this.text.startsWith('"""', this.index)) this.fail("a multi-line string cannot be a key");
      return this.basicString();
    }
    if (char === "'") {
      if (this.text.startsWith("'''", this.index)) this.fail("a multi-line string cannot be a key");
      return this.literalString();
    }
    const start = this.index;
    while (BARE_KEY.test(this.peek())) this.index += 1;
    if (this.index === start) this.fail(`expected a key, found '${char || "end of file"}'`);
    return this.text.slice(start, this.index);
  }

  private dottedKey(): string[] {
    const parts = [this.simpleKey()];
    while (true) {
      this.skipSpaces();
      if (this.peek() !== ".") return parts;
      this.index += 1;
      this.skipSpaces();
      parts.push(this.simpleKey());
    }
  }

  // ---------------------------------------------------------------- statements

  private header(): TomlTable {
    const line = this.line;
    const isArray = this.text.startsWith("[[", this.index);
    this.index += isArray ? 2 : 1;
    this.skipSpaces();
    const path = this.dottedKey();
    this.skipSpaces();
    const closing = isArray ? "]]" : "]";
    if (!this.text.startsWith(closing, this.index)) this.fail(`expected '${closing}'`);
    this.index += closing.length;

    let table = this.root;
    for (const part of path.slice(0, -1)) table = this.descend(table, part, line);
    const last = path[path.length - 1] as string;
    const existing = table.entries.get(last);

    if (isArray) {
      let array: TomlArray;
      if (existing === undefined) {
        array = { type: "array", items: [], line, ofTables: true };
        table.entries.set(last, array);
        table.keyLines.set(last, line);
      } else if (existing.type === "array" && existing.ofTables) {
        array = existing;
      } else {
        this.fail(`'${path.join(".")}' is already defined and is not an array of tables`);
      }
      const item = newTable(line, "array-item");
      array.items.push(item);
      return item;
    }

    if (existing === undefined) {
      const created = newTable(line, "header");
      table.entries.set(last, created);
      table.keyLines.set(last, line);
      this.closed.add(created);
      return created;
    }
    if (existing.type === "table" && existing.origin === "implicit" && !this.closed.has(existing)) {
      existing.origin = "header";
      table.keyLines.set(last, line);
      this.closed.add(existing);
      return existing;
    }
    this.fail(`table '${path.join(".")}' is defined twice`);
  }

  /** Walk into a sub-table for a header path, creating implicit tables. */
  private descend(table: TomlTable, key: string, line: number): TomlTable {
    const existing = table.entries.get(key);
    if (existing === undefined) {
      const created = newTable(line, "implicit");
      table.entries.set(key, created);
      table.keyLines.set(key, line);
      return created;
    }
    if (existing.type === "table") {
      if (existing.origin === "inline")
        this.fail(`'${key}' is an inline table and cannot be extended`);
      return existing;
    }
    if (existing.type === "array" && existing.ofTables) {
      const last = existing.items[existing.items.length - 1];
      if (last?.type !== "table") this.fail(`'${key}' has no table to extend`);
      return last;
    }
    this.fail(`'${key}' is a value, not a table`);
  }

  private keyValue(table: TomlTable) {
    const line = this.line;
    const path = this.dottedKey();
    this.skipSpaces();
    if (this.peek() !== "=") this.fail(`expected '=' after key '${path.join(".")}'`);
    this.index += 1;
    this.skipSpaces();
    const value = this.value();
    this.assign(table, path, value, line);
  }

  private assign(table: TomlTable, path: string[], value: TomlNode, line: number) {
    let target = table;
    for (const part of path.slice(0, -1)) {
      const existing = target.entries.get(part);
      if (existing === undefined) {
        const created = newTable(line, "dotted");
        target.entries.set(part, created);
        target.keyLines.set(part, line);
        target = created;
      } else if (
        existing.type === "table" &&
        (existing.origin === "dotted" || existing.origin === "implicit") &&
        !this.closed.has(existing)
      ) {
        target = existing;
      } else {
        this.fail(`'${part}' cannot be extended by a dotted key`);
      }
    }
    const last = path[path.length - 1] as string;
    if (target.entries.has(last)) this.fail(`key '${path.join(".")}' is defined twice`);
    target.entries.set(last, value);
    target.keyLines.set(last, line);
    if (value.type === "table") this.closed.add(value);
  }

  // ---------------------------------------------------------------- values

  private value(): TomlNode {
    const line = this.line;
    const char = this.peek();
    if (char === '"') {
      const value = this.text.startsWith('"""', this.index)
        ? this.multilineBasicString()
        : this.basicString();
      return { type: "string", value, line };
    }
    if (char === "'") {
      const value = this.text.startsWith("'''", this.index)
        ? this.multilineLiteralString()
        : this.literalString();
      return { type: "string", value, line };
    }
    if (char === "[") return this.array();
    if (char === "{") return this.inlineTable();
    if (this.text.startsWith("true", this.index) && !BARE_KEY.test(this.peek(4))) {
      this.index += 4;
      return { type: "boolean", value: true, line };
    }
    if (this.text.startsWith("false", this.index) && !BARE_KEY.test(this.peek(5))) {
      this.index += 5;
      return { type: "boolean", value: false, line };
    }
    const date = DATE_TIME.exec(this.text.slice(this.index, this.index + 40));
    if (date !== null && !/[0-9A-Za-z_.:+-]/.test(this.peek(date[0].length))) {
      const start = this.index;
      this.index += date[0].length;
      this.dateSpans.push([start, this.index]);
      return { type: "datetime", value: date[0], line };
    }
    const start = this.index;
    while (/[0-9A-Za-z_.+-]/.test(this.peek())) this.index += 1;
    const raw = this.text.slice(start, this.index);
    if (raw === "") this.fail(`expected a value, found '${char || "end of file"}'`);
    if (INTEGER.test(raw)) return { type: "integer", value: Number(raw.replaceAll("_", "")), line };
    if (PREFIXED_INTEGER.test(raw)) {
      return { type: "integer", value: Number(raw.replaceAll("_", "")), line };
    }
    if (FLOAT.test(raw) || /^[+-](?:inf|nan)$/.test(raw)) {
      const unsigned = raw.replace(/^[+-]/, "");
      if (unsigned === "inf")
        return { type: "float", value: raw.startsWith("-") ? -Infinity : Infinity, line };
      if (unsigned === "nan") return { type: "float", value: Number.NaN, line };
      return { type: "float", value: Number(raw.replaceAll("_", "")), line };
    }
    this.fail(`'${raw}' is not a TOML value`);
  }

  private array(): TomlArray {
    const line = this.line;
    this.index += 1;
    const items: TomlNode[] = [];
    while (true) {
      this.skipInsideBrackets();
      if (this.peek() === "]") {
        this.index += 1;
        return { type: "array", items, line, ofTables: false };
      }
      items.push(this.value());
      this.skipInsideBrackets();
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      if (this.peek() === "]") {
        this.index += 1;
        return { type: "array", items, line, ofTables: false };
      }
      this.fail(`expected ',' or ']' in an array, found '${this.peek() || "end of file"}'`);
    }
  }

  private inlineTable(): TomlTable {
    const table = newTable(this.line, "inline");
    this.index += 1;
    while (true) {
      this.skipInsideBrackets();
      if (this.peek() === "}") {
        this.index += 1;
        return table;
      }
      const line = this.line;
      const path = this.dottedKey();
      this.skipSpaces();
      if (this.peek() !== "=") this.fail(`expected '=' after key '${path.join(".")}'`);
      this.index += 1;
      this.skipSpaces();
      const value = this.value();
      this.assignInline(table, path, value, line);
      this.skipInsideBrackets();
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      if (this.peek() === "}") {
        this.index += 1;
        return table;
      }
      this.fail(`expected ',' or '}' in an inline table, found '${this.peek() || "end of file"}'`);
    }
  }

  private assignInline(table: TomlTable, path: string[], value: TomlNode, line: number) {
    let target = table;
    for (const part of path.slice(0, -1)) {
      const existing = target.entries.get(part);
      if (existing === undefined) {
        const created = newTable(line, "dotted");
        target.entries.set(part, created);
        target.keyLines.set(part, line);
        target = created;
      } else if (existing.type === "table" && existing.origin === "dotted") {
        target = existing;
      } else {
        this.fail(`'${part}' cannot be extended by a dotted key`);
      }
    }
    const last = path[path.length - 1] as string;
    if (target.entries.has(last)) this.fail(`key '${path.join(".")}' is defined twice`);
    target.entries.set(last, value);
    target.keyLines.set(last, line);
  }

  // ---------------------------------------------------------------- strings

  private basicString(): string {
    this.index += 1;
    let out = "";
    while (true) {
      const char = this.peek();
      if (char === "" || char === "\n") this.fail("unterminated string");
      if (char === '"') {
        this.index += 1;
        return out;
      }
      if (char === "\\") {
        out += this.escape();
        continue;
      }
      this.controlCheck(char);
      out += char;
      this.index += 1;
    }
  }

  private literalString(): string {
    this.index += 1;
    const start = this.index;
    while (true) {
      const char = this.peek();
      if (char === "" || char === "\n") this.fail("unterminated string");
      if (char === "'") {
        const value = this.text.slice(start, this.index);
        this.index += 1;
        return value;
      }
      this.controlCheck(char);
      this.index += 1;
    }
  }

  private multilineBasicString(): string {
    this.index += 3;
    this.newline();
    let out = "";
    while (true) {
      if (this.index >= this.text.length) this.fail("unterminated multi-line string");
      if (this.text.startsWith('"""', this.index)) {
        // Up to two quotes may sit right before the closing delimiter.
        let extra = 0;
        while (extra < 2 && this.peek(3 + extra) === '"') extra += 1;
        out += '"'.repeat(extra);
        this.index += 3 + extra;
        return out;
      }
      const char = this.peek();
      if (char === "\\") {
        // A line-ending backslash trims the newline and the whitespace after it.
        let probe = this.index + 1;
        while (this.text[probe] === " " || this.text[probe] === "\t") probe += 1;
        if (
          this.text[probe] === "\n" ||
          (this.text[probe] === "\r" && this.text[probe + 1] === "\n")
        ) {
          this.index = probe;
          while (true) {
            if (this.newline()) continue;
            if (this.peek() === " " || this.peek() === "\t") {
              this.index += 1;
              continue;
            }
            break;
          }
          continue;
        }
        out += this.escape();
        continue;
      }
      if (this.newline()) {
        out += "\n";
        continue;
      }
      this.controlCheck(char);
      out += char;
      this.index += 1;
    }
  }

  private multilineLiteralString(): string {
    this.index += 3;
    this.newline();
    let out = "";
    while (true) {
      if (this.index >= this.text.length) this.fail("unterminated multi-line string");
      if (this.text.startsWith("'''", this.index)) {
        let extra = 0;
        while (extra < 2 && this.peek(3 + extra) === "'") extra += 1;
        out += "'".repeat(extra);
        this.index += 3 + extra;
        return out;
      }
      if (this.newline()) {
        out += "\n";
        continue;
      }
      const char = this.peek();
      this.controlCheck(char);
      out += char;
      this.index += 1;
    }
  }

  private controlCheck(char: string) {
    const code = char.charCodeAt(0);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) this.fail("control character in a string");
  }

  private escape(): string {
    this.index += 1;
    const char = this.advance();
    const simple: Record<string, string> = {
      b: "\b",
      t: "\t",
      n: "\n",
      f: "\f",
      r: "\r",
      e: "\u001b",
      '"': '"',
      "\\": "\\",
    };
    const mapped = simple[char];
    if (mapped !== undefined) return mapped;
    const width = char === "x" ? 2 : char === "u" ? 4 : char === "U" ? 8 : 0;
    if (width === 0) this.fail(`invalid escape '\\${char}'`);
    const hex = this.text.slice(this.index, this.index + width);
    if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex))
      this.fail(`invalid escape '\\${char}${hex}'`);
    this.index += width;
    const code = Number.parseInt(hex, 16);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      this.fail(`invalid code point '${hex}'`);
    return String.fromCodePoint(code);
  }
}

function newTable(line: number, origin: TomlTable["origin"]): TomlTable {
  return { type: "table", entries: new Map(), keyLines: new Map(), line, origin };
}
