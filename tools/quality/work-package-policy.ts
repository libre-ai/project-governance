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
 * unreadable" (gate-integrity §2).
 *
 * Ambiguity is refused by a LINE WHITELIST, not by a scanner. A YAML parser
 * resolves a repeated key (last wins), a `<<` merge, an alias, a differently
 * spelled key (`1` / `0x1`, `null` / `~`, `"\x61"` / `a`) silently, and every
 * attempt to detect those cases by re-reading YAML left another hole. So the
 * text is accepted only if every line has one of the few shapes below, which
 * cannot express any of them; the parser then runs once on text that is
 * unambiguous by construction.
 */
import { MATURITY_LADDER, type MaturityLevel, type Parsed } from "./prd-model";
import { findUnreadableCharacter } from "./yaml-text-guard";

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
// Line whitelist
//
//   root     approvedFrom: <scalar>
//            owners:            then "- <scalar>" items, or  owners: [<scalar>, ...]
//            exempt:            then rule blocks,           or  exempt: {}
//   rule     <name>:            (indent 2, name = [a-z][a-z0-9-]*, plain)
//   predicate author: <scalar> | titlePrefix: <scalar>      (indent 4)
//            paths:             then "- <scalar>" items (indent 6), or [<scalar>, ...]
//   scalar   "text without quote or backslash"  |  a bare ASCII token
//
// Two spaces per level, no trailing space, no trailing comment, no
// backslash, no single quote, no document marker. Keys are plain letter-led
// words that cannot be quoted or escaped, so text equality is key equality.
// ---------------------------------------------------------------------------

const KEY_LINE = /^([^:]+):(?: (.+))?$/;
const PLAIN_KEY = /^[A-Za-z][A-Za-z0-9-]*$/;
const RULE_NAME = /^[a-z][a-z0-9-]*$/;
// The words YAML resolves to a boolean or null (any case), or that older
// parsers do; two spellings of one would collapse into one key.
const YAML_WORDS = /^(?:null|true|false|yes|no|on|off|y|n)$/i;
const QUOTED = /^"[^"\\]*"$/;
// Not starting with `*`: that would be an alias.
const BARE_TOKEN = /^[A-Za-z0-9._/-][A-Za-z0-9._/*-]*$/;

/** Names the construct that makes a piece of text unreadable to the whitelist. */
function construct(text: string): string {
  const word = text.split(/[\s,\]}]/, 1)[0] ?? text;
  if (text.startsWith("<<")) {
    return 'merge key "<<"';
  }
  if (/(^|\s)#/.test(text)) {
    return "trailing comment";
  }
  if (text.startsWith("&")) {
    return `anchor "${word}"`;
  }
  if (text.startsWith("*")) {
    return `alias "${word}"`;
  }
  if (text.startsWith("!")) {
    return `tag "${word}"`;
  }
  if (text.startsWith("{")) {
    return "flow mapping";
  }
  if (text.startsWith("[")) {
    return "flow sequence that is not closed on its own line, or nested";
  }
  if (text.startsWith("|") || text.startsWith(">")) {
    return "block scalar";
  }
  if (text.startsWith("?")) {
    return "explicit key";
  }
  if (text.startsWith('"')) {
    return "quoted scalar that is malformed or spans lines";
  }
  return `unsupported text ${JSON.stringify(text)}`;
}

function scalarProblem(text: string): string | undefined {
  return QUOTED.test(text) || BARE_TOKEN.test(text) ? undefined : construct(text);
}

function valueProblem(value: string): string | undefined {
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    for (const item of inner === "" ? [] : inner.split(",")) {
      const problem = scalarProblem(item.trim());
      if (problem !== undefined) {
        return problem;
      }
    }
    return undefined;
  }
  return scalarProblem(value);
}

function keyProblem(key: string, label: string): string | undefined {
  if (key.startsWith("<<")) {
    return 'merge key "<<"';
  }
  if (key.startsWith('"')) {
    return `quoted ${label} ${key} (use a plain word)`;
  }
  if (!PLAIN_KEY.test(key)) {
    return `${label} ${JSON.stringify(key)} is not a plain letter-led word`;
  }
  if (YAML_WORDS.test(key)) {
    return `${label} ${JSON.stringify(key)} is a YAML word that resolves to a non-string`;
  }
  return undefined;
}

/**
 * Constructs refused anywhere, comments and quotes included. Unreadable
 * characters (tab, NUL, separators) are not listed: the shared guard has
 * already refused them.
 */
function forbiddenInLine(line: string): string | undefined {
  if (line.includes("\\")) {
    return "backslash";
  }
  if (line.includes("'")) {
    return "single quote";
  }
  if (/^(?:---|\.\.\.)(?:\s|$)/.test(line)) {
    return "document marker";
  }
  return undefined;
}

interface Seen {
  readonly rootKeys: ReadonlyMap<string, number>;
  readonly ruleNames: ReadonlyMap<string, number>;
}

function readLines(lines: readonly string[]): Parsed<Seen> {
  for (const [position, line] of lines.entries()) {
    const forbidden = forbiddenInLine(line);
    if (forbidden !== undefined) {
      return fail(`line ${position + 1}: ${forbidden} is not allowed`);
    }
  }

  const rootKeys = new Map<string, number>();
  const ruleNames = new Map<string, number>();
  let predicateKeys = new Map<string, number>();
  let section: "owners" | "exempt" | undefined;
  let inRule = false;
  let inPaths = false;

  for (const [position, line] of lines.entries()) {
    const number = position + 1;
    const refuse = (why: string): { readonly ok: false; readonly reason: string } =>
      fail(`line ${number}: ${why}`);
    if (line === "") {
      continue;
    }
    if (/\s$/.test(line)) {
      return refuse("trailing space");
    }
    const spaces = (/^ */.exec(line) as RegExpExecArray)[0].length;
    const content = line.slice(spaces);
    if (content.startsWith("#")) {
      continue;
    }
    if (spaces % 2 !== 0) {
      return refuse("indentation must be a multiple of 2 spaces");
    }
    const level = spaces / 2;

    if (content.startsWith("- ")) {
      const owned = level === 1 && section === "owners";
      if (!owned && !(level === 3 && inPaths)) {
        return refuse(
          level === 0
            ? "policy root must be a block mapping, not a list"
            : "unexpected indentation or list item here",
        );
      }
      const problem = scalarProblem(content.slice(2));
      if (problem !== undefined) {
        return refuse(problem);
      }
      continue;
    }

    const match = KEY_LINE.exec(content);
    if (match === null) {
      return refuse(
        level === 0
          ? `policy root must be a block mapping of plain keys (${construct(content)})`
          : `${construct(content)} where a key line is expected`,
      );
    }
    const key = match[1] as string;
    const value = match[2];

    if (level === 0) {
      const problem = keyProblem(key, "key");
      if (problem !== undefined) {
        return refuse(`policy root: ${problem}`);
      }
      const first = rootKeys.get(key);
      if (first !== undefined) {
        return fail(`duplicate key "${key}" (line ${first} and line ${number})`);
      }
      rootKeys.set(key, number);
      section = value === undefined && (key === "owners" || key === "exempt") ? key : undefined;
      inRule = false;
      inPaths = false;
      const valueIssue =
        value === undefined || (key === "exempt" && value === "{}")
          ? undefined
          : valueProblem(value);
      if (valueIssue !== undefined) {
        return refuse(`${valueIssue} in the value of "${key}"`);
      }
    } else if (level === 1 && section === "exempt") {
      const problem =
        keyProblem(key, "exempt rule name") ??
        (RULE_NAME.test(key)
          ? undefined
          : `exempt rule name "${key}" must be lowercase letters, digits and hyphens`);
      if (problem !== undefined) {
        return refuse(problem);
      }
      const first = ruleNames.get(key);
      if (first !== undefined) {
        return fail(`duplicate key "${key}" (line ${first} and line ${number})`);
      }
      ruleNames.set(key, number);
      if (value !== undefined) {
        return refuse(
          `${valueProblem(value) ?? "scalar value"} after rule name "${key}" (a rule is a block of predicates)`,
        );
      }
      inRule = true;
      inPaths = false;
      predicateKeys = new Map();
    } else if (level === 2 && inRule) {
      const problem = keyProblem(key, "key");
      if (problem !== undefined) {
        return refuse(problem);
      }
      const first = predicateKeys.get(key);
      if (first !== undefined) {
        return fail(`duplicate key "${key}" (line ${first} and line ${number})`);
      }
      predicateKeys.set(key, number);
      inPaths = key === "paths" && value === undefined;
      const valueIssue = value === undefined ? undefined : valueProblem(value);
      if (valueIssue !== undefined) {
        return refuse(`${valueIssue} in the value of "${key}"`);
      }
    } else {
      return refuse("unexpected indentation or list item here");
    }
  }
  return { ok: true, value: { rootKeys, ruleNames } };
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

const sameKeys = (parsed: readonly string[], read: ReadonlyMap<string, number>): boolean =>
  parsed.length === read.size && parsed.every((key) => read.has(key));

export function loadWorkPackagePolicy(text: string): Parsed<WorkPackagePolicy> {
  // First, before any line is read: Bun.YAML.parse silently stops at a NUL and
  // reads a bare CR as a line break, while the line whitelist below would read
  // the whole text. The shared guard leaves only text both read identically
  // (LF or CRLF line ends, no tab, no control or separator characters).
  const unreadable = findUnreadableCharacter(text);
  if (unreadable !== null) {
    return fail(
      `policy contains an unreadable character ${unreadable.codePoint} on line ${unreadable.line}`,
    );
  }
  const seen = readLines(text.split(/\r?\n/));
  if (!seen.ok) {
    return fail(`policy is outside the supported YAML subset: ${seen.reason}`);
  }

  let root: unknown;
  try {
    root = Bun.YAML.parse(text);
  } catch (error) {
    return fail(
      `policy is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(root)) {
    return fail("policy root must be an object");
  }
  // Belt and braces: the parser must have found exactly the keys the whitelist
  // read. A difference means a key resolved to something else than its text.
  // No real text reaches these branches (the whitelist leaves none on which the
  // parser disagrees); both are proven by tests that replace the parser result.
  if (!sameKeys(Object.keys(root), seen.value.rootKeys)) {
    return fail("policy keys differ between the lines read and the parsed value");
  }
  if (isRecord(root.exempt) && !sameKeys(Object.keys(root.exempt), seen.value.ruleNames)) {
    return fail("exempt rule names differ between the lines read and the parsed value");
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
    if (RESERVED_NAMES.includes(name)) {
      return fail(`exempt rule name "${name}" is reserved`);
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
