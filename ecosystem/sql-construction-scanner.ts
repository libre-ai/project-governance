/**
 * Finds SQL built from non-constant text in TypeScript/JavaScript and Rust
 * sources — the scanner behind `check-sql-construction.ts`.
 *
 * Why a lexer and not a grep: the shapes this looks for live inside string and
 * template literals, and a line grep cannot tell `exec(` in a comment from a
 * call, a regex's `.exec(line)` from a database's, nor where a multi-line
 * template starts and stops. Each language gets a small tokenizer that knows
 * its comments, strings, templates (with nested `${}`), regex literals, raw
 * strings and lifetimes; the rules then read tokens. It is not a parser and
 * does not pretend to be: what it cannot classify, it reports, and the
 * allowlist records the human verdict with a reason.
 */

export type SqlRule =
  | "unsafe-call"
  | "exec-non-constant"
  | "sql-template-interpolation"
  | "sql-concatenation"
  | "rust-format-sql";

export const SQL_RULES: readonly SqlRule[] = [
  "unsafe-call",
  "exec-non-constant",
  "sql-template-interpolation",
  "sql-concatenation",
  "rust-format-sql",
];

export interface SqlFinding {
  readonly rule: SqlRule;
  readonly line: number;
}

/**
 * Does this static text read as SQL? The upper-case statement keywords
 * anywhere (the convention every fleet query follows), or a lower-case
 * statement at the very start of the text. Prose that merely says "select" or
 * "update" in lower case mid-sentence is not SQL.
 */
const UPPER_KEYWORD = /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/;
const LOWER_STATEMENT =
  /^\s*(?:select\s[\s\S]*\bfrom\b|insert\s+into\b|update\s+\S+\s+set\b|delete\s+from\b)/i;

export function looksLikeSql(text: string): boolean {
  return UPPER_KEYWORD.test(text) || LOWER_STATEMENT.test(text);
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript
// ---------------------------------------------------------------------------

type TsToken =
  | { readonly kind: "ident"; readonly text: string; readonly line: number }
  | { readonly kind: "punct"; readonly text: string; readonly line: number }
  | { readonly kind: "number"; readonly text: string; readonly line: number }
  | { readonly kind: "string"; readonly text: string; readonly line: number }
  | { readonly kind: "regex"; readonly text: string; readonly line: number }
  | {
      readonly kind: "template";
      readonly text: string;
      readonly line: number;
      readonly interpolated: boolean;
      /** Every `${…}` is a SCREAMING_CASE constant (`${COLUMNS}`, `${Q.COLUMNS}`). */
      readonly constantInterpolations: boolean;
      readonly tagged: boolean;
      /**
       * The tokens of each `${…}`, kept out of the main stream so a template is
       * one token where it stands (`exec(`…`)` sees its argument), and scanned
       * on their own so a call nested in an interpolation is still found.
       */
      readonly expressions: readonly (readonly TsToken[])[];
    };

const SCREAMING = /^[A-Z][A-Z0-9_]*$/;

/** `NAME` or `a.b.NAME`: a reference to a module constant by convention. */
function isConstantReference(tokens: readonly TsToken[]): boolean {
  if (tokens.length === 0 || tokens.length % 2 === 0) return false;
  for (const [index, token] of tokens.entries()) {
    if (
      index % 2 === 1 ? !(token.kind === "punct" && token.text === ".") : token.kind !== "ident"
    ) {
      return false;
    }
  }
  return SCREAMING.test(tokens[tokens.length - 1]?.text ?? "");
}

const KEYWORDS_BEFORE_EXPRESSION = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "instanceof",
  "yield",
  "await",
]);

/** May a `/` here start a regex literal rather than divide? */
function regexAllowedAfter(previous: TsToken | undefined): boolean {
  if (previous === undefined) return true;
  if (previous.kind === "ident") return KEYWORDS_BEFORE_EXPRESSION.has(previous.text);
  if (previous.kind === "punct") return previous.text !== ")" && previous.text !== "]";
  return false;
}

function isTag(previous: TsToken | undefined): boolean {
  if (previous === undefined) return false;
  if (previous.kind === "ident") return !KEYWORDS_BEFORE_EXPRESSION.has(previous.text);
  return previous.kind === "punct" && (previous.text === ")" || previous.text === "]");
}

interface OpenTemplate {
  readonly line: number;
  readonly tagged: boolean;
  text: string;
  interpolated: boolean;
  constantInterpolations: boolean;
  readonly expressions: TsToken[][];
  /** Brace depth inside the current `${ ... }`. */
  depth: number;
  /** Index of the first token of the current `${ ... }`. */
  expressionStart: number;
}

/** Tokenizes TS/JS source. Comments are dropped; literals keep their static text. */
export function tokenizeTypeScript(source: string): TsToken[] {
  const tokens: TsToken[] = [];
  const templates: OpenTemplate[] = [];
  let index = 0;
  let line = 1;
  const last = (): TsToken | undefined => tokens[tokens.length - 1];

  const advance = (count: number): void => {
    for (let k = 0; k < count && index < source.length; k++) {
      if (source[index] === "\n") line++;
      index++;
    }
  };

  /** Scans template text from `index` (just after a backtick or a closing `}`). */
  const scanTemplateText = (template: OpenTemplate): void => {
    while (index < source.length) {
      const char = source[index];
      if (char === "\\") {
        template.text += source.slice(index, index + 2);
        advance(2);
      } else if (char === "`") {
        advance(1);
        templates.pop();
        tokens.push({
          kind: "template",
          text: template.text,
          line: template.line,
          interpolated: template.interpolated,
          constantInterpolations: template.constantInterpolations,
          tagged: template.tagged,
          expressions: template.expressions,
        });
        return;
      } else if (char === "$" && source[index + 1] === "{") {
        template.interpolated = true;
        template.text += " ";
        template.depth = 0;
        template.expressionStart = tokens.length;
        advance(2);
        return;
      } else {
        template.text += char;
        advance(1);
      }
    }
    templates.pop();
  };

  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];
    if (char === "\n" || char === " " || char === "\t" || char === "\r") {
      advance(1);
    } else if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") advance(1);
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      advance(end < 0 ? source.length - index : end + 2 - index);
    } else if (char === "'" || char === '"') {
      const start = line;
      let text = "";
      advance(1);
      while (index < source.length && source[index] !== char && source[index] !== "\n") {
        if (source[index] === "\\") {
          text += source.slice(index, index + 2);
          advance(2);
        } else {
          text += source[index];
          advance(1);
        }
      }
      advance(1);
      tokens.push({ kind: "string", text, line: start });
    } else if (char === "`") {
      const template: OpenTemplate = {
        line,
        tagged: isTag(last()),
        text: "",
        interpolated: false,
        constantInterpolations: true,
        expressions: [],
        depth: 0,
        expressionStart: 0,
      };
      templates.push(template);
      advance(1);
      scanTemplateText(template);
    } else if (char === "/" && regexAllowedAfter(last())) {
      const start = index;
      const startLine = line;
      let inClass = false;
      let cursor = index + 1;
      let closed = false;
      while (cursor < source.length && source[cursor] !== "\n") {
        const c = source[cursor];
        if (c === "\\") cursor += 2;
        else if (c === "[") {
          inClass = true;
          cursor++;
        } else if (c === "]") {
          inClass = false;
          cursor++;
        } else if (c === "/" && !inClass) {
          closed = true;
          cursor++;
          break;
        } else cursor++;
      }
      if (!closed) {
        tokens.push({ kind: "punct", text: "/", line });
        advance(1);
        continue;
      }
      while (cursor < source.length && /[a-z]/i.test(source[cursor] as string)) cursor++;
      advance(cursor - start);
      tokens.push({ kind: "regex", text: source.slice(start, cursor), line: startLine });
    } else if (/[A-Za-z_$#]/.test(char)) {
      const match = /^[A-Za-z_$#][\w$]*/.exec(source.slice(index, index + 256));
      const text = match?.[0] ?? char;
      tokens.push({ kind: "ident", text, line });
      advance(text.length);
    } else if (/[0-9]/.test(char)) {
      const match = /^[0-9][\w.]*/.exec(source.slice(index, index + 64));
      const text = match?.[0] ?? char;
      tokens.push({ kind: "number", text, line });
      advance(text.length);
    } else {
      const open = templates[templates.length - 1];
      if (open !== undefined && char === "{") open.depth++;
      if (open !== undefined && char === "}") {
        if (open.depth === 0) {
          const expression = tokens.splice(open.expressionStart);
          if (!isConstantReference(expression)) open.constantInterpolations = false;
          open.expressions.push(expression);
          advance(1);
          scanTemplateText(open);
          continue;
        }
        open.depth--;
      }
      const pair = source.slice(index, index + 2);
      const text = pair === "?." || pair === "=>" ? pair : char;
      tokens.push({ kind: "punct", text, line });
      advance(text.length);
    }
  }
  return tokens;
}

function isConstantLiteral(token: TsToken | undefined): boolean {
  if (token === undefined) return false;
  if (token.kind === "string") return true;
  return (
    token.kind === "template" &&
    !token.tagged &&
    (!token.interpolated || token.constantInterpolations)
  );
}

function isPunct(token: TsToken | undefined, text: string): boolean {
  return token?.kind === "punct" && token.text === text;
}

/** Identifiers bound to a regex in this file: `NAME = /…/`, `NAME = new RegExp(…)`, `NAME: RegExp = …`. */
function regexBindings(tokens: readonly TsToken[]): Set<string> {
  const names = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token?.kind !== "ident") continue;
    let j = i + 1;
    if (isPunct(tokens[j], "?")) j++;
    // A declared type is enough: `pattern: RegExp` as a parameter or a field
    // names a regex wherever it is read, including `keys.url.exec(line)`.
    if (isPunct(tokens[j], ":") && tokens[j + 1]?.text === "RegExp") {
      names.add(token.text);
      continue;
    }
    if (!isPunct(tokens[j], "=")) continue;
    const value = tokens[j + 1];
    if (value?.kind === "regex") names.add(token.text);
    if (value?.kind === "ident" && value.text === "new" && tokens[j + 2]?.text === "RegExp") {
      names.add(token.text);
    }
  }
  return names;
}

/** Is the receiver of the `.` at `dot` a regex (literal, binding, or `new RegExp(…)`)? */
function receiverIsRegex(tokens: readonly TsToken[], dot: number, bindings: Set<string>): boolean {
  const receiver = tokens[dot - 1];
  if (receiver === undefined) return false;
  if (receiver.kind === "regex") return true;
  if (receiver.kind === "ident") return bindings.has(receiver.text);
  if (isPunct(receiver, ")")) {
    let depth = 0;
    for (let k = dot - 1; k >= 0; k--) {
      if (isPunct(tokens[k], ")")) depth++;
      if (isPunct(tokens[k], "(")) depth--;
      if (depth === 0) {
        return tokens[k - 1]?.text === "RegExp" && tokens[k - 2]?.text === "new";
      }
    }
  }
  return false;
}

/** Every token, interpolation contents included, in source order of their streams. */
function flatten(tokens: readonly TsToken[]): TsToken[] {
  const out: TsToken[] = [];
  for (const token of tokens) {
    out.push(token);
    if (token.kind === "template")
      for (const expression of token.expressions) out.push(...flatten(expression));
  }
  return out;
}

export function scanTypeScript(source: string): SqlFinding[] {
  const tokens = tokenizeTypeScript(source);
  const bindings = regexBindings(flatten(tokens));
  const findings: SqlFinding[] = [];
  scanTokens(tokens, bindings, findings);
  return findings.sort((a, b) => a.line - b.line);
}

function scanTokens(
  tokens: readonly TsToken[],
  bindings: Set<string>,
  findings: SqlFinding[],
): void {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as TsToken;
    if (token.kind === "template") {
      for (const expression of token.expressions) scanTokens(expression, bindings, findings);
    }
    const previous = tokens[i - 1];
    const following = tokens[i + 1];
    const memberCall =
      token.kind === "ident" &&
      (isPunct(previous, ".") || isPunct(previous, "?.")) &&
      isPunct(following, "(");
    if (memberCall && token.text === "unsafe") {
      findings.push({ rule: "unsafe-call", line: token.line });
    }
    if (memberCall && token.text === "exec" && !receiverIsRegex(tokens, i - 1, bindings)) {
      const argument = tokens[i + 2];
      const after = tokens[i + 3];
      const constant = isConstantLiteral(argument) && (isPunct(after, ")") || isPunct(after, ","));
      if (!constant) findings.push({ rule: "exec-non-constant", line: token.line });
    }
    if (
      token.kind === "template" &&
      !token.tagged &&
      token.interpolated &&
      !token.constantInterpolations &&
      looksLikeSql(token.text)
    ) {
      findings.push({ rule: "sql-template-interpolation", line: token.line });
    } else if (
      (token.kind === "string" || (token.kind === "template" && !token.tagged)) &&
      looksLikeSql(token.text) &&
      (isPunct(previous, "+") || isPunct(following, "+"))
    ) {
      findings.push({ rule: "sql-concatenation", line: token.line });
    }
  }
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

type RsToken =
  | { readonly kind: "ident"; readonly text: string; readonly line: number }
  | { readonly kind: "punct"; readonly text: string; readonly line: number }
  | { readonly kind: "string"; readonly text: string; readonly line: number }
  | { readonly kind: "other"; readonly text: string; readonly line: number };

export function tokenizeRust(source: string): RsToken[] {
  const tokens: RsToken[] = [];
  let index = 0;
  let line = 1;
  const advance = (count: number): void => {
    for (let k = 0; k < count && index < source.length; k++) {
      if (source[index] === "\n") line++;
      index++;
    }
  };
  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];
    if (/\s/.test(char)) {
      advance(1);
    } else if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") advance(1);
    } else if (char === "/" && next === "*") {
      let depth = 0;
      while (index < source.length) {
        if (source.startsWith("/*", index)) {
          depth++;
          advance(2);
        } else if (source.startsWith("*/", index)) {
          depth--;
          advance(2);
          if (depth === 0) break;
        } else advance(1);
      }
    } else if (/^(?:b?r#*")/.test(source.slice(index, index + 64))) {
      const head = /^b?r(#*)"/.exec(source.slice(index, index + 64)) as RegExpExecArray;
      const hashes = head[1] ?? "";
      const start = line;
      advance(head[0].length);
      const end = source.indexOf(`"${hashes}`, index);
      const stop = end < 0 ? source.length : end;
      const text = source.slice(index, stop);
      advance(stop - index + 1 + hashes.length);
      tokens.push({ kind: "string", text, line: start });
    } else if (char === '"' || (char === "b" && next === '"')) {
      const start = line;
      advance(char === "b" ? 2 : 1);
      let text = "";
      while (index < source.length && source[index] !== '"') {
        if (source[index] === "\\") {
          text += source.slice(index, index + 2);
          advance(2);
        } else {
          text += source[index];
          advance(1);
        }
      }
      advance(1);
      tokens.push({ kind: "string", text, line: start });
    } else if (char === "'") {
      // A char literal closes within a few characters; a lifetime never closes.
      const literal = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]{1,6}\}|.)|[^\\'\n])'/.exec(
        source.slice(index, index + 16),
      );
      const text = literal?.[0] ?? "'";
      tokens.push({ kind: "other", text, line });
      advance(text.length);
    } else if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_]\w*/.exec(source.slice(index, index + 256));
      const text = match?.[0] ?? char;
      tokens.push({ kind: "ident", text, line });
      advance(text.length);
    } else if (/[0-9]/.test(char)) {
      const match = /^[0-9][\w.]*/.exec(source.slice(index, index + 64));
      const text = match?.[0] ?? char;
      tokens.push({ kind: "other", text, line });
      advance(text.length);
    } else {
      const pair = source.slice(index, index + 2);
      const text = pair === "::" ? pair : char;
      tokens.push({ kind: "punct", text, line });
      advance(text.length);
    }
  }
  return tokens;
}

const CLOSERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

/** A constant argument: a SCREAMING_CASE path (`COLUMNS`, `Self::COLUMNS`, `crate::q::COLS`) or a lone literal. */
function isConstantRustExpression(tokens: readonly RsToken[]): boolean {
  if (tokens.length === 1 && tokens[0]?.kind === "string") return true;
  const text = tokens.map((t) => t.text).join("");
  return /^(?:[A-Za-z_]\w*::)*[A-Z][A-Z0-9_]*$/.test(text);
}

/** The argument references of a format string, in order: positional `{}`, `{0}`, or named `{x}`. */
export function formatPlaceholders(format: string): (number | string)[] {
  const references: (number | string)[] = [];
  let positional = 0;
  for (let i = 0; i < format.length; i++) {
    const char = format[i];
    if (char === "{" && format[i + 1] === "{") {
      i++;
      continue;
    }
    if (char === "}" && format[i + 1] === "}") {
      i++;
      continue;
    }
    if (char !== "{") continue;
    const close = format.indexOf("}", i);
    if (close < 0) break;
    const spec = (format.slice(i + 1, close).split(":")[0] ?? "").trim();
    if (spec === "") references.push(positional++);
    else if (/^\d+$/.test(spec)) references.push(Number(spec));
    else references.push(spec);
    i = close;
  }
  return references;
}

export function scanRust(source: string): SqlFinding[] {
  const tokens = tokenizeRust(source);
  const findings: SqlFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as RsToken;
    if (token.kind !== "ident" || token.text !== "format") continue;
    if (tokens[i + 1]?.text !== "!") continue;
    const opener = tokens[i + 2]?.text ?? "";
    const closer = CLOSERS[opener];
    if (closer === undefined) continue;
    // Split the macro body into top-level arguments.
    const args: RsToken[][] = [[]];
    let depth = 0;
    let k = i + 3;
    for (; k < tokens.length; k++) {
      const t = tokens[k] as RsToken;
      if (t.kind === "punct" && (t.text === "(" || t.text === "[" || t.text === "{")) depth++;
      if (t.kind === "punct" && (t.text === ")" || t.text === "]" || t.text === "}")) {
        if (depth === 0) break;
        depth--;
      }
      if (depth === 0 && t.kind === "punct" && t.text === ",") args.push([]);
      else (args[args.length - 1] as RsToken[]).push(t);
    }
    i = k;
    const formatToken = args[0]?.[0];
    if (args[0]?.length !== 1 || formatToken?.kind !== "string") continue;
    if (!looksLikeSql(formatToken.text)) continue;
    const rest = args.slice(1).filter((arg) => arg.length > 0);
    const positional: RsToken[][] = [];
    const named = new Map<string, RsToken[]>();
    for (const arg of rest) {
      if (arg[0]?.kind === "ident" && arg[1]?.text === "=" && arg[2]?.text !== "=") {
        named.set(arg[0].text, arg.slice(2));
      } else positional.push(arg);
    }
    const constant = formatPlaceholders(formatToken.text).every((reference) => {
      if (typeof reference === "number") {
        const arg = positional[reference];
        return arg !== undefined && isConstantRustExpression(arg);
      }
      const bound = named.get(reference);
      if (bound !== undefined) return isConstantRustExpression(bound);
      return SCREAMING.test(reference);
    });
    if (!constant) findings.push({ rule: "rust-format-sql", line: formatToken.line });
  }
  return findings;
}

const TYPESCRIPT_SOURCE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
const RUST_SOURCE = /\.rs$/;

export function isScannedSource(path: string): boolean {
  return TYPESCRIPT_SOURCE.test(path) || RUST_SOURCE.test(path);
}

export function scanSource(path: string, source: string): SqlFinding[] {
  if (RUST_SOURCE.test(path)) return scanRust(source);
  if (TYPESCRIPT_SOURCE.test(path)) return scanTypeScript(source);
  return [];
}
