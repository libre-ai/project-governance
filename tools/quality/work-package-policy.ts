/**
 * Policy of the work-package gate, read from
 * ecosystem/work-package-policy.v1.yaml.
 *
 * Why data: who is exempt and from which maturity level the gate applies are
 * decisions to review, not behaviour to bury in the gate. The `exempt` object
 * only DESCRIBES predicates; the gate verifies each one against the pull
 * request itself and never believes an author's claim about it. That is why a
 * rule carries exactly one predicate: two would make "which one was verified"
 * ambiguous.
 *
 * The loader fails closed. A policy that cannot be read in full yields
 * `ok: false` naming the cause, never a default or a partial policy, so that
 * a gate built on it cannot confuse "no exemption declared" with "policy
 * unreadable" (gate-integrity §2). That includes ambiguity: a YAML parser
 * resolves a repeated key (last wins), a `<<` merge or an alias silently, and
 * a reviewer reading the file would see something else than what is enforced.
 * Such input is refused, not interpreted.
 */
import { MATURITY_LADDER, type MaturityLevel, type Parsed } from "./prd-model";

export type ExemptRule =
  | { readonly author: string }
  | { readonly paths: readonly string[] }
  | { readonly titlePrefix: string };

export interface WorkPackagePolicy {
  readonly approvedFrom: MaturityLevel;
  readonly exempt: Readonly<Record<string, ExemptRule>>;
  readonly owners: readonly string[];
}

const fail = (reason: string): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason,
});

const ROOT_KEYS = ["approvedFrom", "exempt", "owners"] as const;
const PREDICATE_KEYS = ["author", "paths", "titlePrefix"] as const;

// Names that would reach Object.prototype machinery if used as a property key.
const RESERVED_NAMES: readonly string[] = ["__proto__", "constructor", "prototype"];

// A rule name is an identifier, so that two spellings cannot resolve to one key
// (see plainKeyProblem) and the name is safe to print and to compare.
const RULE_NAME = /^[a-z][a-z0-9-]*$/;

// GitHub login: 1 to 39 characters of [A-Za-z0-9-], not starting or ending
// with a hyphen. The gate compares logins case-insensitively.
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Blank means whitespace-only: such a predicate would match nothing useful and
// would read as filled in. The stored value is never trimmed ("Revert " keeps
// its trailing space).
function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Ambiguity pre-scan
//
// Bun.YAML.parse offers no hook on duplicate keys, merge keys or aliases, so
// the text is scanned structurally before (and independently of) the parse.
// The scanner understands only what the policy needs: block mappings and
// sequences, flow collections on one line, and plain / quoted scalars. Any
// construct it cannot read with certainty (block scalars, multi-line flow or
// quoted scalars, explicit `?` keys, extra documents) is refused rather than
// skipped, so it can never hide a duplicate from the check.
// ---------------------------------------------------------------------------

interface Quoted {
  readonly end: number;
  readonly value: string;
}

function readQuoted(source: string, start: number): Quoted | undefined {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (quote === '"' && char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) {
      if (quote === "'" && source[index + 1] === "'") {
        index += 2;
        continue;
      }
      const token = source.slice(start, index + 1);
      return { end: index + 1, value: unquote(token) };
    }
    index += 1;
  }
  return undefined;
}

function unquote(token: string): string {
  if (token.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(token);
      if (typeof decoded === "string") {
        return decoded;
      }
    } catch {
      // Not valid JSON escapes: compare the raw text, which still catches the
      // common case of the same spelling repeated.
    }
    return token.slice(1, -1);
  }
  return token.slice(1, -1).replaceAll("''", "'");
}

function isBreak(char: string | undefined): boolean {
  return char === undefined || char === " " || char === "\t";
}

/** Names the node-start indicator that makes a node ambiguous, if any. */
function indicatorProblem(source: string): string | undefined {
  const token = (): string => source.split(/[\s,}\]]/, 1)[0] ?? "";
  if (source.startsWith("&")) {
    return `anchor "${token()}" is not supported (a rule must declare its own predicate)`;
  }
  if (source.startsWith("*")) {
    return `alias "${token()}" is not supported (a rule must declare its own predicate)`;
  }
  if (source.startsWith("!")) {
    return `tag "${token()}" is not supported`;
  }
  if (source.startsWith("|") || source.startsWith(">")) {
    return "block scalars are not supported";
  }
  if (source.startsWith("?") && isBreak(source[1])) {
    return "explicit keys (?) are not supported";
  }
  return undefined;
}

function mergeKeyProblem(name: string): string | undefined {
  return name === "<<"
    ? 'merge key "<<" is not supported (a rule must declare its own predicate)'
    : undefined;
}

// YAML resolves an unquoted key by its type before it becomes a property name:
// `1`, `0x1` and `1.0` are one integer key, `null` and `~` one null key, and
// `true` / `True` one boolean key. Two spellings of the same key would then
// pass the duplicate check on their text and collapse silently in the parse.
// An unquoted key must therefore be a letter-led word that is not null/true/
// false; anything else has to be quoted, which makes it a string verbatim.
function plainKeyProblem(name: string): string | undefined {
  if (/^[A-Za-z]/.test(name) && !/^(?:null|true|false)$/i.test(name)) {
    return undefined;
  }
  return `key "${name}" is an unquoted key that YAML may resolve to a non-string or to the same key as another spelling (use a letter-led word, or quote it)`;
}

/** Scans a one-line flow collection; returns the index after it, or a problem. */
function scanFlow(source: string, lineNumber: number): string | undefined {
  let index = 0;
  const at = (message: string): string => `line ${lineNumber}: ${message}`;
  const skipSpaces = (): void => {
    while (source[index] === " " || source[index] === "\t") {
      index += 1;
    }
  };

  const readPlain = (stopAtColon: boolean): string => {
    const begin = index;
    while (index < source.length) {
      const char = source[index];
      if (char === "," || char === "}" || char === "]") {
        break;
      }
      if (
        stopAtColon &&
        char === ":" &&
        (isBreak(source[index + 1]) || /[,}\]]/.test(source[index + 1] ?? ""))
      ) {
        break;
      }
      index += 1;
    }
    return source.slice(begin, index).trim();
  };

  const readNode = (): string | undefined => {
    skipSpaces();
    const char = source[index];
    if (char === "{") {
      return readMapping();
    }
    if (char === "[") {
      return readSequence();
    }
    if (char === '"' || char === "'") {
      const quoted = readQuoted(source, index);
      if (quoted === undefined) {
        return at("unterminated quoted scalar (multi-line scalars are not supported)");
      }
      index = quoted.end;
      return undefined;
    }
    const indicator = indicatorProblem(source.slice(index));
    if (indicator !== undefined) {
      return at(indicator);
    }
    readPlain(false);
    return undefined;
  };

  const readMapping = (): string | undefined => {
    index += 1;
    const seen = new Set<string>();
    for (;;) {
      skipSpaces();
      if (index >= source.length) {
        return at("unterminated flow mapping (multi-line flow collections are not supported)");
      }
      if (source[index] === "}") {
        index += 1;
        return undefined;
      }
      let name: string;
      const char = source[index];
      if (char === '"' || char === "'") {
        const quoted = readQuoted(source, index);
        if (quoted === undefined) {
          return at("unterminated quoted scalar (multi-line scalars are not supported)");
        }
        index = quoted.end;
        name = quoted.value;
      } else {
        const indicator = indicatorProblem(source.slice(index));
        if (indicator !== undefined) {
          return at(indicator);
        }
        name = readPlain(true);
        // The merge key has its own, more specific refusal just below.
        const plain = mergeKeyProblem(name) === undefined ? plainKeyProblem(name) : undefined;
        if (plain !== undefined) {
          return at(plain);
        }
      }
      const merge = mergeKeyProblem(name);
      if (merge !== undefined) {
        return at(merge);
      }
      if (seen.has(name)) {
        return at(`duplicate key "${name}" (line ${lineNumber} and line ${lineNumber})`);
      }
      seen.add(name);
      skipSpaces();
      if (source[index] === ":") {
        index += 1;
        const problem = readNode();
        if (problem !== undefined) {
          return problem;
        }
      }
      skipSpaces();
      if (source[index] === ",") {
        index += 1;
      } else if (source[index] !== "}") {
        return at("unexpected character in flow mapping");
      }
    }
  };

  const readSequence = (): string | undefined => {
    index += 1;
    for (;;) {
      skipSpaces();
      if (index >= source.length) {
        return at("unterminated flow sequence (multi-line flow collections are not supported)");
      }
      if (source[index] === "]") {
        index += 1;
        return undefined;
      }
      const problem = readNode();
      if (problem !== undefined) {
        return problem;
      }
      skipSpaces();
      if (source[index] === ",") {
        index += 1;
      } else if (source[index] !== "]") {
        return at("unexpected character in flow sequence");
      }
    }
  };

  const problem = readNode();
  if (problem !== undefined) {
    return problem;
  }
  skipSpaces();
  if (index < source.length && source[index] !== "#") {
    return at("unexpected content after a flow collection");
  }
  return undefined;
}

/** Checks the text of a value or of a bare node (no key in front of it). */
function scanNode(source: string, lineNumber: number): string | undefined {
  const text = source.trim();
  if (text === "" || text.startsWith("#")) {
    return undefined;
  }
  const indicator = indicatorProblem(text);
  if (indicator !== undefined) {
    return `line ${lineNumber}: ${indicator}`;
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    return scanFlow(text, lineNumber);
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    return readQuoted(text, 0) === undefined
      ? `line ${lineNumber}: unterminated quoted scalar (multi-line scalars are not supported)`
      : undefined;
  }
  return undefined;
}

interface Frame {
  readonly indent: number;
  readonly keys: Map<string, number>;
}

function findAmbiguity(text: string): string | undefined {
  // Every line break the parser honours, so line numbers stay right.
  const lines = text.split(/\r\n|\r|\n/);
  const frames: Frame[] = [];
  let sawContent = false;

  for (const [position, line] of lines.entries()) {
    const lineNumber = position + 1;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    if (/^(---|\.\.\.)(\s|$)/.test(line)) {
      if (!sawContent && trimmed === "---") {
        continue;
      }
      return `line ${lineNumber}: document markers are not supported (a policy is a single document)`;
    }
    sawContent = true;

    let column = line.length - line.trimStart().length;
    let rest = line.slice(column);
    while (rest === "-" || rest.startsWith("- ") || rest.startsWith("-\t")) {
      // A new sequence entry closes every mapping opened inside the previous one.
      while (frames.length > 0 && (frames.at(-1)?.indent ?? 0) > column) {
        frames.pop();
      }
      const after = rest.slice(1);
      column += 1 + (after.length - after.trimStart().length);
      rest = after.trimStart();
    }
    if (rest === "" || rest.startsWith("#")) {
      continue;
    }

    const indicator = indicatorProblem(rest);
    if (indicator !== undefined) {
      return `line ${lineNumber}: ${indicator}`;
    }
    if (rest.startsWith("{") || rest.startsWith("[")) {
      const problem = scanFlow(rest, lineNumber);
      if (problem !== undefined) {
        return problem;
      }
      continue;
    }

    let name: string | undefined;
    let valueText = "";
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quoted = readQuoted(rest, 0);
      if (quoted === undefined) {
        return `line ${lineNumber}: unterminated quoted scalar (multi-line scalars are not supported)`;
      }
      const after = rest.slice(quoted.end).trimStart();
      if (after.startsWith(":") && isBreak(after[1])) {
        name = quoted.value;
        valueText = after.slice(1);
      }
    } else {
      for (let index = 0; index < rest.length; index += 1) {
        if (rest[index] === "#" && index > 0 && isBreak(rest[index - 1])) {
          break;
        }
        if (rest[index] === ":" && isBreak(rest[index + 1])) {
          name = rest.slice(0, index).trimEnd();
          valueText = rest.slice(index + 1);
          const plain = mergeKeyProblem(name) === undefined ? plainKeyProblem(name) : undefined;
          if (plain !== undefined) {
            return `line ${lineNumber}: ${plain}`;
          }
          break;
        }
      }
    }

    if (name === undefined) {
      const problem = scanNode(rest, lineNumber);
      if (problem !== undefined) {
        return problem;
      }
      continue;
    }

    const merge = mergeKeyProblem(name);
    if (merge !== undefined) {
      return `line ${lineNumber}: ${merge}`;
    }
    while (frames.length > 0 && (frames.at(-1)?.indent ?? 0) > column) {
      frames.pop();
    }
    let frame = frames.at(-1);
    if (frame === undefined || frame.indent < column) {
      frame = { indent: column, keys: new Map() };
      frames.push(frame);
    }
    const first = frame.keys.get(name);
    if (first !== undefined) {
      return `duplicate key "${name}" (line ${first} and line ${lineNumber})`;
    }
    frame.keys.set(name, lineNumber);

    const problem = scanNode(valueText, lineNumber);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Validation of the parsed value
// ---------------------------------------------------------------------------

function parseOwners(raw: unknown): Parsed<readonly string[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail("owners must be a non-empty array of GitHub logins");
  }
  const seen = new Map<string, string>();
  for (const entry of raw as readonly unknown[]) {
    if (typeof entry !== "string") {
      return fail(`owners must contain only strings, got ${JSON.stringify(entry)}`);
    }
    if (!GITHUB_LOGIN.test(entry)) {
      return fail(
        `owners entry ${JSON.stringify(entry)} is not a GitHub login (1 to 39 characters of letters, digits and hyphens, no leading or trailing hyphen)`,
      );
    }
    const earlier = seen.get(entry.toLowerCase());
    if (earlier !== undefined) {
      return fail(
        `owners has duplicate entry ${JSON.stringify(entry)} (same login as ${JSON.stringify(earlier)}, compared case-insensitively)`,
      );
    }
    seen.set(entry.toLowerCase(), entry);
  }
  return { ok: true, value: [...(raw as readonly string[])] };
}

function parseRule(name: string, raw: unknown): Parsed<ExemptRule> {
  if (!isRecord(raw)) {
    return fail(`exempt rule "${name}" must be an object with exactly one predicate`);
  }
  const keys = Object.keys(raw);
  const unknown = keys.filter((key) => !(PREDICATE_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return fail(
      `exempt rule "${name}" has unknown key "${unknown[0]}" (expected one of ${PREDICATE_KEYS.join(", ")})`,
    );
  }
  if (keys.length !== 1) {
    return fail(
      `exempt rule "${name}" must have exactly one predicate (${PREDICATE_KEYS.join(", ")}), found ${keys.length}`,
    );
  }
  const [key] = keys;
  const value = raw[key as string];
  if (key === "author" || key === "titlePrefix") {
    if (!isFilledString(value)) {
      return fail(`exempt rule "${name}": ${key} must be a non-blank string`);
    }
    return { ok: true, value: key === "author" ? { author: value } : { titlePrefix: value } };
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every(isFilledString)) {
    return fail(`exempt rule "${name}": paths must be a non-empty array of non-blank strings`);
  }
  const globs = value as readonly string[];
  const seen = new Set<string>();
  for (const glob of globs) {
    if (seen.has(glob)) {
      return fail(`exempt rule "${name}": paths has duplicate entry ${JSON.stringify(glob)}`);
    }
    seen.add(glob);
  }
  return { ok: true, value: { paths: [...globs] } };
}

export function loadWorkPackagePolicy(text: string): Parsed<WorkPackagePolicy> {
  // Bun.YAML reads a lone CR as a line break; a reviewer's editor and git diff
  // often do not. Refusing it keeps one reading of the file. (Checked before
  // the parse so no later step sees a text read two ways.)
  if (/\r(?!\n)/.test(text)) {
    return fail(
      "policy has a bare CR line ending (a lone \\r not followed by \\n); use LF or CRLF",
    );
  }
  let root: unknown;
  try {
    root = Bun.YAML.parse(text);
  } catch (error) {
    // The parser reports e.g. "Unresolved alias" without naming the construct
    // the author wrote: add the scanner's finding when it has one.
    const construct = findAmbiguity(text);
    return fail(
      `policy is not valid YAML: ${error instanceof Error ? error.message : String(error)}${
        construct === undefined ? "" : ` (${construct})`
      }`,
    );
  }
  const ambiguity = findAmbiguity(text);
  if (ambiguity !== undefined) {
    return fail(`policy YAML is ambiguous: ${ambiguity}`);
  }
  if (!isRecord(root)) {
    return fail("policy root must be an object");
  }
  const unknownRoot = Object.keys(root).filter(
    (key) => !(ROOT_KEYS as readonly string[]).includes(key),
  );
  if (unknownRoot.length > 0) {
    return fail(`policy has unknown key "${unknownRoot[0]}" (expected ${ROOT_KEYS.join(", ")})`);
  }
  for (const key of ROOT_KEYS) {
    if (!(key in root)) {
      return fail(`policy is missing required key "${key}"`);
    }
  }

  const approvedFrom = root.approvedFrom;
  if (
    typeof approvedFrom !== "string" ||
    !(MATURITY_LADDER as readonly string[]).includes(approvedFrom)
  ) {
    return fail(
      `approvedFrom must be one of the maturity ladder (${MATURITY_LADDER.join(", ")}), got ${JSON.stringify(approvedFrom)}`,
    );
  }

  const owners = parseOwners(root.owners);
  if (!owners.ok) {
    return owners;
  }

  if (!isRecord(root.exempt)) {
    return fail("exempt must be an object of named rules");
  }
  // No prototype: a rule name can then never collide with an inherited member.
  const exempt = Object.create(null) as Record<string, ExemptRule>;
  for (const [name, raw] of Object.entries(root.exempt)) {
    if (!isFilledString(name)) {
      return fail("exempt rule names must be non-blank");
    }
    if (RESERVED_NAMES.includes(name)) {
      return fail(`exempt rule name "${name}" is reserved`);
    }
    if (!RULE_NAME.test(name)) {
      return fail(
        `exempt rule name ${JSON.stringify(name)} must match ${RULE_NAME.source} (lowercase letters, digits and hyphens, letter first)`,
      );
    }
    const rule = parseRule(name, raw);
    if (!rule.ok) {
      return rule;
    }
    exempt[name] = rule.value;
  }

  return {
    ok: true,
    value: { approvedFrom: approvedFrom as MaturityLevel, exempt, owners: owners.value },
  };
}
