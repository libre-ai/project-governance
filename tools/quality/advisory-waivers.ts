// allow-audit-flag-fixture: this module documents `bun audit --ignore=<id>`
// command lines in its comments; it waives nothing.
//
// Advisory-waiver discipline — the pure half of check-advisory-waivers.ts.
//
// docs/security/ADVISORY-WAIVER-POLICY.md requires every waived advisory to be
// dated, referenced and bounded, and a required gate that verifies the three
// mechanically. The fleet's only instance of that gate was
// `scripts/advisory-waiver-gate.sh` in `libre-ai/feed-radar` (merged as
// 4f0f2bbccb146db9192c1bfc11fd0c3b08a372f8, 2026-07-26). That repository was
// deleted; its successor `information-feed-filter` is archived and does not
// carry the script. This module re-implements the same rules for every waiver
// mechanism the fleet uses, so the policy points at a gate that exists.
//
// What a waiver must carry, on the SAME line as the advisory id:
//
//   "RUSTSEC-2026-0174", # why it is acceptable; expires=2026-09-30; ref=docs/adr/0005-x.md
//
//   - an id (RUSTSEC-, GHSA-, CVE- or, for cargo-deny, a crate spec);
//   - `expires=YYYY-MM-DD`, a real calendar date — except where the mechanism
//     has its own expiry field (osv-scanner `ignoreUntil` / `effectiveUntil`),
//     which is then the only expiry read;
//   - `ref=<record>`, a tracked repository-relative FILE other than the waiver
//     file itself, or an https URL;
//   - a justification: at least MIN_JUSTIFICATION_CHARS characters of words
//     once the tokens and any path are removed.
//
// And, once per file that carries at least one waiver:
//
//   # waiver-review-anchor: YYYY-MM-DD
//
// the date the list was last read against the resolved graph. It bounds the
// horizon rule and only moves by re-reading the entries.
//
// Two tiers, kept from the original design:
//
//   Tier 1 — a pure function of the committed files. Missing or malformed id,
//   missing or malformed date, an expiry written where the mechanism ignores
//   it, missing or unresolved ref, missing justification, missing or malformed
//   anchor, an entry already lapsed at the anchor, an entry dated beyond the
//   horizon, and the same id waived with different dates in two files. A tree
//   that passes tier 1 cannot turn red on these rules without a commit.
//
//   Tier 2 — the only clock-dependent verdict. `today > expires` fails; an
//   expiry within the warning window is announced on every run before it
//   blocks, so the red never arrives unannounced. A review anchor dated after
//   `today` also fails: it is the one way to stretch the horizon without
//   reviewing anything, and the clock can only turn that red into green.
//
// Deliberately NOT done here: running `cargo audit`, `cargo deny` or `bun
// audit`. A required check that fetches an advisory database turns a branch
// red on an upstream publication with no local commit (ADR-0021). This gate
// checks the discipline of the waiver list, never its truth against the graph.
//
// Fail closed on what cannot be read. A waiver source that cannot be read, or
// whose content two independent readings disagree on, is a defect — never
// zero waivers. "This file waives nothing" and "this file could not be read"
// must not produce the same trace (gate-integrity §2).
//
// The 2026-10-09 adversarial review of PR #56 (cases c00–c51) found the first
// version blind in eleven ways; tools/quality/check-advisory-waivers.adversarial.test.ts
// replays each case against the whole gate. The structural answers:
//
//   - TOML sources are read by a positional TOML parser (./toml-document.ts),
//     never by a line scanner, and its value tree must equal Bun.TOML's.
//     A decoy list inside a multi-line string is a string.
//   - osv-scanner files are parsed, not scanned, and every raw occurrence of
//     `IgnoredVulns` and of `ignore = true` must be accounted for by a key the
//     parser read; an occurrence nobody attributes is UNPARSEABLE.
//   - Command lines are joined across `\` continuations and YAML block
//     scalars before they are read, and every tracked text file is swept for
//     a waiver-shaped flag near an audit command: a flag no reader attributes
//     to an entry is UNPARSEABLE, never silently absent.
//   - The "equivalent mechanisms" of the policy (`[graph] exclude`,
//     `unmaintained`/`unsound` scopes, `vulnerability`/`notice` downgrades,
//     cargo-audit `severity_threshold`, `cargo deny -A/-W <advisory code>`,
//     `bun audit --audit-level`) are waivers and carry the same metadata.
//
// Reuse: any other control that needs the fleet's waivers (the periodic fleet
// advisory report, for one) reads them with `readWaiverFile` — on a clone or on
// files fetched one by one — so that it sees exactly what this gate sees.
// Never a second parser.

import {
  disagreementWithBun,
  parseTomlDocument,
  type TomlDocument,
  type TomlNode,
  TomlSyntaxError,
  type TomlTable,
} from "./toml-document";

export const HORIZON_DAYS = 365;
export const WARN_WINDOW_DAYS = 30;
/** Characters of words a justification needs once tokens and paths are removed. */
export const MIN_JUSTIFICATION_CHARS = 10;
/** A text file carrying this marker is a test fixture: swept out by name, never silently. */
export const FIXTURE_MARKER = "allow-audit-flag-fixture";

export type WaiverSourceKind =
  | "cargo-audit"
  | "cargo-deny"
  | "osv-scanner"
  | "audit-command"
  | "other-text";

export interface WaiverEntry {
  readonly file: string;
  readonly line: number;
  /** The advisory id, crate spec or mechanism label (`graph.exclude "openssl"`); null when absent. */
  readonly id: string | null;
  /** The text the ref and justification are read from: the line's comment, plus a table `reason`. */
  readonly metadata: string;
  /**
   * Set when the mechanism has its own expiry field (osv-scanner): the field's
   * calendar date, or null when the field is absent. The expiry is then read
   * from this field ONLY; an `expires=` in the metadata is a defect.
   */
  readonly nativeExpiry?: { readonly field: string; readonly value: string | null };
  /** True for ids taken from a command line, which must look like an advisory id. */
  readonly idMustBeAdvisory?: boolean;
}

export type SkipReason = "no audit command" | "fixture-marked";

export interface SourceReading {
  readonly file: string;
  readonly kind: WaiverSourceKind;
  readonly entries: readonly WaiverEntry[];
  readonly anchor: string | null;
  /** Non-null when the source could not be read or parsed. Never counted as zero. */
  readonly error: string | null;
  /** Lines carrying a waiver-shaped flag that no reader attributed to an entry. */
  readonly unattributed: readonly number[];
  /** Non-null when the file was classified but had nothing to inspect, and why. */
  readonly skipped: SkipReason | null;
}

export type DefectCode =
  | "UNREADABLE"
  | "UNPARSEABLE"
  | "NO-ID"
  | "MALFORMED-ID"
  | "UNDATED"
  | "MALFORMED-DATE"
  | "MISPLACED-EXPIRY"
  | "UNREFERENCED"
  | "UNRESOLVED-REF"
  | "UNJUSTIFIED"
  | "NO-ANCHOR"
  | "MALFORMED-ANCHOR"
  | "FUTURE-ANCHOR"
  | "LAPSED"
  | "OVER-HORIZON"
  | "EXPIRED"
  | "INCOHERENT";

export interface Defect {
  readonly code: DefectCode;
  readonly where: string;
  readonly message: string;
}

export interface Evaluation {
  /** Every file classified as a possible waiver source. */
  readonly classified: number;
  /** Classified files actually read for waivers: classified = inspected + skipped. */
  readonly inspected: number;
  readonly skippedNoCommand: number;
  readonly fixtureMarked: readonly string[];
  readonly filesByKind: Readonly<Record<WaiverSourceKind, number>>;
  readonly waivers: number;
  readonly expiringSoon: number;
  readonly defects: readonly Defect[];
  readonly warnings: readonly string[];
  /** One line per clean waiver, the evidence a passing run can print. */
  readonly clean: readonly string[];
}

export interface EvaluationOptions {
  /** ISO 8601 calendar date, UTC. Passed in so the clock is a test input. */
  readonly today: string;
  /** Whether a repository-relative path names a tracked FILE (a directory is not a record). */
  readonly isTrackedFile: (path: string) => boolean;
  readonly horizonDays?: number;
  readonly warnWindowDays?: number;
}

// ------------------------------------------------------------------ dates

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 for a real calendar date, or null. */
export function dayNumber(value: string): number | null {
  const match = ISO_DATE.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  // Date.UTC normalises 2026-02-30 to 2026-03-02; a round trip that changes the
  // components means the input was not a real calendar date.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;
  return Math.round(time / 86_400_000);
}

// ------------------------------------------------------------------ metadata

// `(?<![\w-])`: `noexpires=` and `preref=` are not tokens (review case c45).
const EXPIRES_TOKEN = /(?<![\w-])expires=(\S*?)(?=[;,\s"]|$)/;
const REF_TOKEN = /(?<![\w-])ref=([^;,\s"]+)/;
const ANCHOR_TEXT = /^\s*waiver-review-anchor:\s*(\S+)/;
const ANCHOR_LINE = /#\s*waiver-review-anchor:\s*(\S+)/;
const ADVISORY_ID = /^(?:RUSTSEC|GHSA|CVE)-[\w-]+$/;

export interface WaiverMetadata {
  /** The raw `expires=` value, or null when the token is absent. */
  readonly expires: string | null;
  readonly ref: string | null;
  readonly justification: string;
}

export function readMetadata(text: string): WaiverMetadata {
  const expires = EXPIRES_TOKEN.exec(text)?.[1] ?? null;
  const ref = REF_TOKEN.exec(text)?.[1] ?? null;
  const justification = text
    .replace(/(?<![\w-])expires=\S*?(?=[;,\s"]|$)/g, " ")
    .replace(/(?<![\w-])ref=[^;,\s"]+/g, " ")
    .replace(/\breason\s*=/g, " ")
    .replace(/[#;,"'{}=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { expires, ref, justification };
}

/**
 * A justification states something: once path- and URL-shaped words are
 * removed, at least MIN_JUSTIFICATION_CHARS characters in at least two words.
 * "ok" (c47) and "see docs/adr/0005-x.md" are not justifications.
 */
export function isJustification(justification: string): boolean {
  const words = justification
    .split(/\s+/)
    .filter((word) => word !== "" && !word.includes("/") && /[A-Za-z]/.test(word));
  return words.length >= 2 && words.join(" ").length >= MIN_JUSTIFICATION_CHARS;
}

export function readAnchor(text: string): string | null {
  for (const line of text.split("\n")) {
    const match = ANCHOR_LINE.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/** The anchor of a TOML file, read from its real comments only (never from a string). */
function tomlAnchor(document: TomlDocument): string | null {
  const lines = [...document.comments.keys()].sort((a, b) => a - b);
  for (const line of lines) {
    const match = ANCHOR_TEXT.exec(document.comments.get(line) ?? "");
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

// ------------------------------------------------------------------ classification

/**
 * Which waiver mechanism a tracked path is, by its name, or null.
 *
 * cargo-deny reads `deny.toml`, `.deny.toml` and `.cargo/deny.toml` (measured
 * on 0.19.5). Audit commands are read where a command line lives: workflows,
 * composite actions, package manifests, shell scripts, Makefiles, justfiles.
 * Every other tracked text file is classified `other-text` by its CONTENT, in
 * `readWaiverFile`, when it carries a waiver-shaped flag near an audit command.
 */
export function classifySource(path: string): Exclude<WaiverSourceKind, "other-text"> | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (path === ".cargo/audit.toml" || path.endsWith("/.cargo/audit.toml")) return "cargo-audit";
  if (name === "deny.toml" || name === ".deny.toml") return "cargo-deny";
  if (name === "osv-scanner.toml") return "osv-scanner";
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return "audit-command";
  if (name === "action.yml" || name === "action.yaml") return "audit-command";
  if (name === "package.json" || name.endsWith(".sh") || name.endsWith(".bash")) {
    return "audit-command";
  }
  if (/^(?:GNU)?[Mm]akefile$|\.mk$/.test(name)) return "audit-command";
  if (/^\.?[Jj]ustfile$/.test(name)) return "audit-command";
  return null;
}

function emptyReading(file: string, kind: WaiverSourceKind): SourceReading {
  return { file, kind, entries: [], anchor: null, error: null, unattributed: [], skipped: null };
}

function failedReading(file: string, kind: WaiverSourceKind, error: string): SourceReading {
  return { ...emptyReading(file, kind), error };
}

// ------------------------------------------------------------------ TOML sources

function readToml(text: string): { document: TomlDocument } | { error: string } {
  let document: TomlDocument;
  try {
    document = parseTomlDocument(text);
  } catch (error) {
    if (error instanceof TomlSyntaxError) return { error: `not valid TOML: ${error.message}` };
    throw error;
  }
  const disagreement = disagreementWithBun(text, document);
  if (disagreement !== null)
    return { error: `not read the same by two TOML parsers: ${disagreement}` };
  return { document };
}

function stringField(table: TomlTable, key: string): string | null {
  const node = table.entries.get(key);
  return node?.type === "string" ? node.value : null;
}

/** A key looked up case-insensitively, as osv-scanner's TOML decoder does. */
function looseEntry(table: TomlTable, key: string): [string, TomlNode] | null {
  for (const [name, node] of table.entries) {
    if (name.toLowerCase() === key.toLowerCase()) return [name, node];
  }
  return null;
}

function looseString(table: TomlTable, key: string): string | null {
  const found = looseEntry(table, key);
  return found !== null && found[1].type === "string" ? found[1].value : null;
}

function subTable(table: TomlTable, key: string): TomlTable | null | "not-a-table" {
  const node = table.entries.get(key);
  if (node === undefined) return null;
  return node.type === "table" ? node : "not-a-table";
}

function comment(document: TomlDocument, line: number): string {
  return document.comments.get(line) ?? "";
}

/**
 * `.cargo/audit.toml`, `deny.toml`: `[advisories] ignore = [...]`, plus the
 * equivalent mechanisms of the policy.
 */
export function readCargoSource(
  file: string,
  kind: "cargo-audit" | "cargo-deny",
  text: string,
): SourceReading {
  const read = readToml(text);
  if ("error" in read) return failedReading(file, kind, read.error);
  const { document } = read;
  const entries: WaiverEntry[] = [];

  const advisories = subTable(document.root, "advisories");
  if (advisories === "not-a-table") return failedReading(file, kind, "`advisories` is not a table");
  if (advisories !== null) {
    const ignore = advisories.entries.get("ignore");
    if (ignore !== undefined && ignore.type !== "array") {
      return failedReading(file, kind, "`advisories.ignore` is not an array");
    }
    for (const item of ignore?.type === "array" ? ignore.items : []) {
      let id: string | null = null;
      let reason = "";
      if (item.type === "string") {
        id = item.value;
      } else if (item.type === "table") {
        // cargo-deny admits `{ crate = "openssl@0.10.0", reason = ... }` (c32).
        id = stringField(item, "id") ?? (kind === "cargo-deny" ? stringField(item, "crate") : null);
        reason = stringField(item, "reason") ?? "";
      }
      entries.push({
        file,
        line: item.line,
        id: id === "" ? null : id,
        metadata: `${reason} ${comment(document, item.line)}`.trim(),
      });
    }

    // Equivalent mechanisms (owner decision 2026-10-09): a scope that leaves
    // advisories out, or a level that stops them failing, waives them.
    const scopes = kind === "cargo-deny" ? ["unmaintained", "unsound"] : [];
    for (const key of scopes) {
      const node = advisories.entries.get(key);
      if (node?.type === "string" && node.value !== "all") {
        const line = advisories.keyLines.get(key) ?? node.line;
        entries.push({
          file,
          line,
          id: `advisories.${key} = "${node.value}"`,
          metadata: comment(document, line),
        });
      }
    }
    const levels = kind === "cargo-deny" ? ["vulnerability", "notice"] : [];
    for (const key of levels) {
      const node = advisories.entries.get(key);
      if (node?.type === "string" && node.value !== "deny") {
        const line = advisories.keyLines.get(key) ?? node.line;
        entries.push({
          file,
          line,
          id: `advisories.${key} = "${node.value}"`,
          metadata: comment(document, line),
        });
      }
    }
    if (kind === "cargo-audit") {
      const node = advisories.entries.get("severity_threshold");
      if (node !== undefined) {
        const line = advisories.keyLines.get("severity_threshold") ?? node.line;
        const value = node.type === "string" ? node.value : String(toLabel(node));
        entries.push({
          file,
          line,
          id: `advisories.severity_threshold = "${value}"`,
          metadata: comment(document, line),
        });
      }
    }
  }

  if (kind === "cargo-deny") {
    const graph = subTable(document.root, "graph");
    if (graph === "not-a-table") return failedReading(file, kind, "`graph` is not a table");
    const exclude = graph?.entries.get("exclude");
    if (exclude !== undefined && exclude.type !== "array") {
      return failedReading(file, kind, "`graph.exclude` is not an array");
    }
    for (const item of exclude?.type === "array" ? exclude.items : []) {
      const spec =
        item.type === "string"
          ? item.value
          : item.type === "table"
            ? (stringField(item, "crate") ?? stringField(item, "name"))
            : null;
      entries.push({
        file,
        line: item.line,
        id: spec === null || spec === "" ? null : `graph.exclude "${spec}"`,
        metadata: comment(document, item.line),
      });
    }
  }

  return { ...emptyReading(file, kind), entries, anchor: tomlAnchor(document) };
}

function toLabel(node: TomlNode): string {
  return node.type === "array" || node.type === "table" ? node.type : String(node.value);
}

// ------------------------------------------------------------------ osv-scanner

function calendarDate(node: TomlNode | undefined): string | null {
  if (node === undefined) return null;
  // A TOML datetime (`2026-09-30T00:00:00Z`) expires on its calendar date.
  if (node.type === "datetime" || node.type === "string") return node.value.slice(0, 10);
  return toLabel(node);
}

function countIgnoreTrue(node: TomlNode): number {
  if (node.type === "array")
    return node.items.reduce((sum, item) => sum + countIgnoreTrue(item), 0);
  if (node.type !== "table") return 0;
  let count = 0;
  for (const [key, value] of node.entries) {
    if (key.toLowerCase() === "ignore" && value.type === "boolean" && value.value) count += 1;
    count += countIgnoreTrue(value);
  }
  return count;
}

function countKeys(node: TomlNode, name: string): number {
  if (node.type === "array") {
    return node.items.reduce((sum, item) => sum + countKeys(item, name), 0);
  }
  if (node.type !== "table") return 0;
  let count = 0;
  for (const [key, value] of node.entries) {
    if (key.toLowerCase() === name) {
      // `[[IgnoredVulns]]` writes the key once per table; an inline array once.
      count += value.type === "array" && value.ofTables ? value.items.length : 1;
    }
    count += countKeys(value, name);
  }
  return count;
}

/**
 * `osv-scanner.toml`: `[[IgnoredVulns]]` (any spelling osv-scanner's decoder
 * accepts: quoted, lower-case, inline array) and `[[PackageOverrides]]` with
 * `ignore = true` or `vulnerability.ignore = true`.
 *
 * The expiry is the native field — `ignoreUntil`, `effectiveUntil` for an
 * override — and nothing else: osv-scanner does not read an `expires=` written
 * in `reason`, so a gate that did would accept a waiver the scanner applies
 * forever (c10, c11). `ref=` and the justification live in `reason`.
 */
export function readOsvSource(file: string, text: string): SourceReading {
  const kind = "osv-scanner";
  const read = readToml(text);
  if ("error" in read) return failedReading(file, kind, read.error);
  const { document } = read;
  const entries: WaiverEntry[] = [];

  const vulns = looseEntry(document.root, "IgnoredVulns");
  if (vulns !== null) {
    const [, node] = vulns;
    if (node.type !== "array") return failedReading(file, kind, "`IgnoredVulns` is not an array");
    for (const item of node.items) {
      if (item.type !== "table") {
        return failedReading(file, kind, `line ${item.line}: an IgnoredVulns entry is not a table`);
      }
      const id = looseString(item, "id");
      entries.push({
        file,
        line: item.line,
        id: id === null || id === "" ? null : id,
        metadata: looseString(item, "reason") ?? "",
        nativeExpiry: {
          field: "ignoreUntil",
          value: calendarDate(looseEntry(item, "ignoreUntil")?.[1]),
        },
      });
    }
  }

  const overrides = looseEntry(document.root, "PackageOverrides");
  if (overrides !== null) {
    const [, node] = overrides;
    if (node.type !== "array")
      return failedReading(file, kind, "`PackageOverrides` is not an array");
    for (const item of node.items) {
      if (item.type !== "table") {
        return failedReading(
          file,
          kind,
          `line ${item.line}: a PackageOverrides entry is not a table`,
        );
      }
      const ignore = looseEntry(item, "ignore")?.[1];
      const vulnerability = looseEntry(item, "vulnerability")?.[1];
      const vulnerabilityIgnore =
        vulnerability?.type === "table" ? looseEntry(vulnerability, "ignore")?.[1] : undefined;
      const ignored =
        (ignore?.type === "boolean" && ignore.value) ||
        (vulnerabilityIgnore?.type === "boolean" && vulnerabilityIgnore.value);
      if (!ignored) continue;
      const ecosystem = looseString(item, "ecosystem") ?? "*";
      const name = looseString(item, "name") ?? "*";
      entries.push({
        file,
        line: item.line,
        id: `PackageOverrides ${ecosystem}/${name}`,
        metadata: looseString(item, "reason") ?? "",
        nativeExpiry: {
          field: "effectiveUntil",
          value: calendarDate(looseEntry(item, "effectiveUntil")?.[1]),
        },
      });
    }
  }

  // Raw cross-check: every occurrence of the two waiver words in the text is a
  // key the parser read. One that sits in a string, a comment, or a table the
  // reader does not know is a reading it cannot vouch for (fail closed).
  const rawVulns = text.match(/ignoredvulns/gi)?.length ?? 0;
  const readVulns = countKeys(document.root, "ignoredvulns");
  if (rawVulns !== readVulns) {
    return failedReading(
      file,
      kind,
      `has ${rawVulns} occurrence(s) of IgnoredVulns but ${readVulns} read as keys; ` +
        "an occurrence outside a key cannot be attributed",
    );
  }
  const rawIgnore = text.match(/(?<![\w-])ignore\s*=\s*true(?![\w-])/gi)?.length ?? 0;
  const readIgnore = countIgnoreTrue(document.root);
  if (rawIgnore !== readIgnore) {
    return failedReading(
      file,
      kind,
      `has ${rawIgnore} occurrence(s) of \`ignore = true\` but ${readIgnore} read as keys; ` +
        "an occurrence outside a key cannot be attributed",
    );
  }

  return { ...emptyReading(file, kind), entries, anchor: tomlAnchor(document) };
}

// ------------------------------------------------------------------ audit commands

const AUDIT_COMMAND =
  /(?<![\w-])(?:bunx?\s+(?:pm\s+)?audit|cargo(?:\s+\+\S+)?[\s-]+audit)(?![\w-])/g;
const DENY_COMMAND = /(?<![\w-])cargo(?:\s+\+\S+)?[\s-]+deny(?![\w-])/g;
const COMMAND_END = /&&|\|\||[;|]|$/;
const IGNORE_FLAG = /(?<![\w-])--ignore(?:=|\s+)(["']?)([^\s"']*)\1/g;
const AUDIT_LEVEL_FLAG = /(?<![\w-])--audit-level(?:=|\s+)(["']?)([^\s"']*)\1/g;
const DENY_LEVEL_FLAG = /(?<![\w-])(-A|--allow|-W|--warn)(?:=|\s+)(["']?)([^\s"']*)\2/g;
/** cargo-deny diagnostic codes that, allowed or warned, stop an advisory from failing. */
const DENY_ADVISORY_CODES = new Set([
  "vulnerability",
  "unmaintained",
  "unsound",
  "notice",
  "yanked",
]);

// The raw sweep: a waiver-shaped flag within SWEEP_WINDOW lines after an audit
// command word. Deliberately looser than the readers above.
const SWEEP_WINDOW = 3;
const RAW_AUDIT_WORD = /(?<![\w-])audit(?![\w-])/;
const RAW_AUDIT_FLAG = /(?<![\w-])(?:--ignore|--audit-level)(?![\w-])/;
const RAW_DENY_WORD = /cargo(?:\s+\+\S+)?[\s-]+deny(?![\w-])|cargo-deny/;
const RAW_DENY_FLAG = /(?<![\w-])(?:-A|--allow|-W|--warn)(?:=|\s)/;

interface Piece {
  readonly line: number;
  readonly code: string;
  readonly comment: string;
}

function splitComment(raw: string): { code: string; comment: string } {
  const hash = raw.search(/(^|\s)#/);
  return hash === -1
    ? { code: raw, comment: "" }
    : { code: raw.slice(0, hash), comment: raw.slice(hash) };
}

/**
 * Physical lines grouped into logical commands: a `\` continuation joins the
 * next line; a YAML block scalar opened by `>` (folded) is one command, one
 * opened by `|` (literal) keeps its lines, continuations included.
 */
function logicalCommands(lines: readonly string[], yaml: boolean): Piece[][] {
  const commands: Piece[][] = [];
  let index = 0;
  const pushLines = (from: number, to: number) => {
    let current: Piece[] = [];
    for (let at = from; at < to; at += 1) {
      const raw = lines[at] ?? "";
      const { code, comment } = splitComment(raw);
      const continued = /\\\s*$/.test(code);
      current.push({ line: at + 1, code: code.replace(/\\\s*$/, " "), comment });
      if (!continued) {
        commands.push(current);
        current = [];
      }
    }
    if (current.length > 0) commands.push(current);
  };

  while (index < lines.length) {
    const raw = lines[index] ?? "";
    const block = yaml
      ? /^(\s*)(?:-\s+)?[^\s#:][^#:]*:\s*([|>])[-+0-9]*\s*(?:#.*)?$/.exec(raw)
      : null;
    if (block === null) {
      // Plain lines: a run of `\`-continued lines is one command.
      let end = index + 1;
      while (end < lines.length && /\\\s*$/.test(splitComment(lines[end - 1] ?? "").code)) end += 1;
      pushLines(index, end);
      index = end;
      continue;
    }
    const indent = (block[1] ?? "").length;
    let end = index + 1;
    while (end < lines.length) {
      const next = lines[end] ?? "";
      if (next.trim() !== "" && (/^\s*/.exec(next)?.[0].length ?? 0) <= indent) break;
      end += 1;
    }
    commands.push([{ line: index + 1, ...splitComment(raw) }]);
    if (block[2] === ">") {
      const folded: Piece[] = [];
      for (let at = index + 1; at < end; at += 1) {
        const { code, comment } = splitComment(lines[at] ?? "");
        folded.push({ line: at + 1, code: code.replace(/\\\s*$/, " "), comment });
      }
      commands.push(folded);
    } else {
      pushLines(index + 1, end);
    }
    index = end;
  }
  return commands;
}

interface Located {
  readonly text: string;
  readonly lineAt: (offset: number) => Piece;
}

function joinPieces(pieces: readonly Piece[]): Located {
  let text = "";
  const starts: number[] = [];
  for (const piece of pieces) {
    starts.push(text.length);
    text += `${piece.code} `;
  }
  return {
    text,
    lineAt: (offset) => {
      let found = 0;
      for (let at = 0; at < starts.length; at += 1) if ((starts[at] ?? 0) <= offset) found = at;
      return pieces[found] as Piece;
    },
  };
}

/** Lines carrying a waiver-shaped flag near an audit or cargo-deny command word. */
export function waiverShapedLines(text: string): number[] {
  const lines = text.split("\n");
  const found: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const window = lines.slice(Math.max(0, index - SWEEP_WINDOW), index + 1);
    const nearAudit = RAW_AUDIT_FLAG.test(raw) && window.some((line) => RAW_AUDIT_WORD.test(line));
    const nearDeny = RAW_DENY_FLAG.test(raw) && window.some((line) => RAW_DENY_WORD.test(line));
    if (nearAudit || nearDeny) found.push(index + 1);
  }
  return found;
}

/**
 * Audit and cargo-deny command lines: `bun audit --ignore=<id>`, `cargo audit
 * --ignore <id>`, `bun audit --audit-level=<level>`, `cargo deny ... -A
 * <advisory code>`.
 *
 * The metadata is read from the physical line that carries the flag, after a
 * shell or YAML `#`. A package.json cannot carry a comment at all, so an
 * exclusion written there fails as UNDATED, which is the intended outcome: an
 * exclusion that cannot say when it ends belongs on a line that can.
 *
 * Any waiver-shaped flag the reading does not attribute to an entry (a YAML
 * plain scalar continued on the next line, an argv array in a script) is
 * reported in `unattributed`, and the evaluation fails it as UNPARSEABLE.
 */
export function readAuditCommandSource(file: string, text: string): SourceReading {
  const lines = text.split("\n");
  const yaml = /\.ya?ml$/.test(file);
  const entries: WaiverEntry[] = [];
  const attributed = new Set<number>();
  let sawCommand = false;

  for (const pieces of logicalCommands(lines, yaml)) {
    const { text: command, lineAt } = joinPieces(pieces);
    const segments: { start: number; kind: "audit" | "deny"; label: string }[] = [];
    for (const match of command.matchAll(AUDIT_COMMAND)) {
      const label = /^bun/.test(match[0]) ? "bun audit" : "cargo audit";
      segments.push({ start: (match.index ?? 0) + match[0].length, kind: "audit", label });
    }
    for (const match of command.matchAll(DENY_COMMAND)) {
      segments.push({
        start: (match.index ?? 0) + match[0].length,
        kind: "deny",
        label: "cargo deny",
      });
    }
    if (segments.length > 0) sawCommand = true;

    for (const segment of segments) {
      const rest = command.slice(segment.start);
      const end = COMMAND_END.exec(rest)?.index ?? rest.length;
      const args = rest.slice(0, end);
      const at = (offset: number) => lineAt(segment.start + offset);

      if (segment.kind === "audit") {
        for (const match of args.matchAll(IGNORE_FLAG)) {
          const piece = at(match.index ?? 0);
          attributed.add(piece.line);
          for (const id of (match[2] ?? "").split(",")) {
            entries.push({
              file,
              line: piece.line,
              id: id === "" ? null : id,
              metadata: piece.comment,
              idMustBeAdvisory: true,
            });
          }
        }
        for (const match of args.matchAll(AUDIT_LEVEL_FLAG)) {
          const piece = at(match.index ?? 0);
          attributed.add(piece.line);
          entries.push({
            file,
            line: piece.line,
            id: `${segment.label} --audit-level=${match[2] ?? ""}`,
            metadata: piece.comment,
          });
        }
      } else {
        for (const match of args.matchAll(DENY_LEVEL_FLAG)) {
          const piece = at(match.index ?? 0);
          // Read and judged: a code that is not an advisory code is no waiver.
          attributed.add(piece.line);
          for (const code of (match[3] ?? "").split(",")) {
            if (!DENY_ADVISORY_CODES.has(code)) continue;
            entries.push({
              file,
              line: piece.line,
              id: `cargo deny ${match[1]} ${code}`,
              metadata: piece.comment,
            });
          }
        }
      }
    }
  }

  const unattributed = waiverShapedLines(text).filter((line) => !attributed.has(line));
  const skipped = !sawCommand && unattributed.length === 0 ? "no audit command" : null;
  return {
    file,
    kind: "audit-command",
    entries,
    anchor: readAnchor(text),
    error: null,
    unattributed,
    skipped,
  };
}

// ------------------------------------------------------------------ entry point

export function readSource(file: string, kind: WaiverSourceKind, text: string): SourceReading {
  if (kind === "cargo-audit" || kind === "cargo-deny") return readCargoSource(file, kind, text);
  if (kind === "osv-scanner") return readOsvSource(file, text);
  if (kind === "audit-command") return readAuditCommandSource(file, text);
  return readOtherText(file, text);
}

/** A text file with no reader: every waiver-shaped flag in it is unattributed. */
function readOtherText(file: string, text: string): SourceReading {
  if (text.includes(FIXTURE_MARKER))
    return { ...emptyReading(file, "other-text"), skipped: "fixture-marked" };
  return { ...emptyReading(file, "other-text"), unattributed: waiverShapedLines(text) };
}

/**
 * Read one tracked file exactly as the advisory-waiver gate reads it.
 *
 * This is the single reading of the fleet's advisory waivers: the gate calls it
 * for every tracked file, and any other control that reports waivers (the
 * periodic fleet advisory report) must call it too — on a clone or on files
 * fetched one by one — rather than parse waiver files itself.
 *
 * - `path` is the repository-relative path; it decides the mechanism.
 * - `text` is the file's content (UTF-8).
 * - Returns null when the file is not a waiver source: neither a named
 *   mechanism nor a text file with a waiver-shaped flag near an audit command.
 * - Otherwise returns the `SourceReading`: `entries` are the waivers (id or
 *   mechanism label, line, metadata, native expiry), `error` is non-null when
 *   the file could not be read reliably (count it as a failure, never as zero
 *   waivers), `unattributed` lists waiver-shaped flags no reader could attribute.
 *
 * Judging the entries (dated, referenced, bounded) is `evaluateWaivers`.
 */
export function readWaiverFile(path: string, text: string): SourceReading | null {
  const kind = classifySource(path);
  if (kind !== null) return readSource(path, kind, text);
  if (waiverShapedLines(text).length === 0) return null;
  return readOtherText(path, text);
}

export function unreadableSource(
  file: string,
  kind: WaiverSourceKind,
  reason: string,
): SourceReading {
  return failedReading(file, kind, `could not be read: ${reason}`);
}

// ------------------------------------------------------------------ evaluation

function refResolves(ref: string, file: string, isTrackedFile: (path: string) => boolean): boolean {
  if (/^https:\/\/\S+$/.test(ref)) return true;
  const path = ref.replace(/#.*$/, "").replace(/^\.\//, "");
  if (path === "" || path.startsWith("/") || path.split("/").includes("..")) return false;
  // The waiver file cannot be its own record (c41), and a directory is not a
  // record anyone can read (c44).
  if (path === file) return false;
  return isTrackedFile(path);
}

export function evaluateWaivers(
  readings: readonly SourceReading[],
  options: EvaluationOptions,
): Evaluation {
  const horizon = options.horizonDays ?? HORIZON_DAYS;
  const warnWindow = options.warnWindowDays ?? WARN_WINDOW_DAYS;
  const today = dayNumber(options.today);
  if (today === null) throw new Error(`today '${options.today}' is not an ISO 8601 calendar date`);

  const defects: Defect[] = [];
  const warnings: string[] = [];
  const clean: string[] = [];
  const datesById = new Map<string, Map<string, string[]>>();
  const filesByKind: Record<WaiverSourceKind, number> = {
    "cargo-audit": 0,
    "cargo-deny": 0,
    "osv-scanner": 0,
    "audit-command": 0,
    "other-text": 0,
  };
  const fixtureMarked: string[] = [];
  let skippedNoCommand = 0;
  let waivers = 0;
  let expiringSoon = 0;

  for (const reading of readings) {
    filesByKind[reading.kind] += 1;
    if (reading.skipped === "fixture-marked") {
      fixtureMarked.push(reading.file);
      continue;
    }
    if (reading.skipped === "no audit command") {
      skippedNoCommand += 1;
      continue;
    }
    if (reading.error !== null) {
      const code = reading.error.startsWith("could not be read") ? "UNREADABLE" : "UNPARSEABLE";
      defects.push({
        code,
        where: reading.file,
        message: `${reading.kind} waiver source ${reading.error} — counted as a failure, never as zero waivers`,
      });
      continue;
    }
    for (const line of reading.unattributed) {
      defects.push({
        code: "UNPARSEABLE",
        where: `${reading.file}:${line}`,
        message:
          "carries a waiver-shaped flag (--ignore, --audit-level, -A/-W) near an audit command that no " +
          "reader attributes to an entry; write it on one line of a workflow, action, manifest or " +
          `script, or mark a fixture file with \`${FIXTURE_MARKER}\``,
      });
    }
    if (reading.entries.length === 0) continue;

    let anchor: number | null = null;
    if (reading.anchor === null) {
      defects.push({
        code: "NO-ANCHOR",
        where: reading.file,
        message:
          "carries waivers but no `# waiver-review-anchor: YYYY-MM-DD` line; the lapsed and horizon rules cannot be evaluated",
      });
    } else {
      anchor = dayNumber(reading.anchor);
      if (anchor === null) {
        defects.push({
          code: "MALFORMED-ANCHOR",
          where: reading.file,
          message: `waiver-review-anchor '${reading.anchor}' is not a real ISO 8601 calendar date`,
        });
      } else if (anchor > today + 1) {
        // +1: a commit made on day D east of UTC can legitimately carry D while
        // the runner's UTC clock still reads D-1.
        defects.push({
          code: "FUTURE-ANCHOR",
          where: reading.file,
          message: `waiver-review-anchor ${reading.anchor} is after today (${options.today}); an anchor nobody has reached cannot record a review`,
        });
        anchor = null;
      }
    }

    for (const entry of reading.entries) {
      waivers += 1;
      const where = `${entry.file}:${entry.line}`;
      const before = defects.length;
      if (entry.id === null) {
        defects.push({ code: "NO-ID", where, message: "a waiver entry names no advisory id" });
        continue;
      }
      const label = `${where} ${entry.id}`;
      if (entry.idMustBeAdvisory === true && !ADVISORY_ID.test(entry.id)) {
        // `--ignore="$IDS"` (c23): the gate cannot know what a variable expands to.
        defects.push({
          code: "MALFORMED-ID",
          where: label,
          message:
            "is not an advisory id (RUSTSEC-, GHSA-, CVE-); an id behind a variable or a pattern cannot be judged — write each id literally",
        });
        continue;
      }
      const metadata = readMetadata(entry.metadata);

      let rawExpiry: string | null = metadata.expires;
      if (entry.nativeExpiry !== undefined) {
        rawExpiry = entry.nativeExpiry.value;
        if (metadata.expires !== null) {
          defects.push({
            code: "MISPLACED-EXPIRY",
            where: label,
            message: `writes expires=${metadata.expires} in its reason, which the scanner never reads; the expiry is \`${entry.nativeExpiry.field}\` only`,
          });
        }
      }

      let expires: number | null = null;
      if (rawExpiry === null) {
        defects.push({
          code: "UNDATED",
          where: label,
          message:
            entry.nativeExpiry === undefined
              ? "carries no `expires=YYYY-MM-DD` on its line; an undated waiver is permanent"
              : `carries no \`${entry.nativeExpiry.field}\`; an undated waiver is permanent`,
        });
      } else {
        expires = dayNumber(rawExpiry);
        if (expires === null) {
          defects.push({
            code: "MALFORMED-DATE",
            where: label,
            message: `expiry ${rawExpiry} is not a real ISO 8601 calendar date`,
          });
        }
      }

      if (metadata.ref === null) {
        defects.push({
          code: "UNREFERENCED",
          where: label,
          message:
            "carries no `ref=`; a date with no record behind it is a renewal with nothing to read",
        });
      } else if (!refResolves(metadata.ref, entry.file, options.isTrackedFile)) {
        defects.push({
          code: "UNRESOLVED-REF",
          where: label,
          message: `ref=${metadata.ref} names no tracked file of this repository other than the waiver file itself (repository-relative file path or https URL expected)`,
        });
      }

      if (!isJustification(metadata.justification)) {
        defects.push({
          code: "UNJUSTIFIED",
          where: label,
          message: `states no justification beside its tokens (at least ${MIN_JUSTIFICATION_CHARS} characters in two words, a path is not one)`,
        });
      }

      if (expires !== null && rawExpiry !== null) {
        const byFile = datesById.get(entry.id) ?? new Map<string, string[]>();
        byFile.set(rawExpiry, [...(byFile.get(rawExpiry) ?? []), where]);
        datesById.set(entry.id, byFile);

        if (anchor !== null) {
          if (expires < anchor) {
            defects.push({
              code: "LAPSED",
              where: label,
              message: `expires=${rawExpiry} predates the review anchor ${reading.anchor}; it was already expired when the list was last reviewed`,
            });
          } else if (expires - anchor > horizon) {
            defects.push({
              code: "OVER-HORIZON",
              where: label,
              message: `expires=${rawExpiry} is more than ${horizon} days past the anchor ${reading.anchor}; a waiver dated that far out is never reviewed again`,
            });
          }
        }

        if (today > expires) {
          defects.push({
            code: "EXPIRED",
            where: label,
            message: `expired on ${rawExpiry}; re-verify the advisory against the graph, then remove or renew the entry`,
          });
        } else if (expires - today <= warnWindow) {
          expiringSoon += 1;
          warnings.push(
            `${label} expires on ${rawExpiry}, in ${expires - today} day(s); re-verify it now — it becomes a failure the day after`,
          );
        }
      }

      if (defects.length === before) {
        clean.push(`${label} — expires=${rawExpiry}, ref=${metadata.ref}`);
      }
    }
  }

  for (const [id, byDate] of datesById) {
    if (byDate.size < 2) continue;
    const listing = [...byDate.entries()]
      .map(([date, places]) => `${date} (${places.join(", ")})`)
      .join(" vs ");
    defects.push({
      code: "INCOHERENT",
      where: id,
      message: `is waived with different dates: ${listing}; the same advisory must expire on the same day everywhere`,
    });
  }

  return {
    classified: readings.length,
    inspected: readings.length - skippedNoCommand - fixtureMarked.length,
    skippedNoCommand,
    fixtureMarked,
    filesByKind,
    waivers,
    expiringSoon,
    defects,
    warnings,
    clean,
  };
}

export function volumeLine(evaluation: Evaluation): string {
  const kinds = evaluation.filesByKind;
  const skipped = evaluation.skippedNoCommand + evaluation.fixtureMarked.length;
  const reasons: string[] = [];
  if (evaluation.skippedNoCommand > 0)
    reasons.push(`${evaluation.skippedNoCommand} no audit command`);
  if (evaluation.fixtureMarked.length > 0) {
    reasons.push(
      `${evaluation.fixtureMarked.length} fixture-marked: ${evaluation.fixtureMarked.join(", ")}`,
    );
  }
  const detail = reasons.length === 0 ? "" : `: ${reasons.join(", ")}`;
  return (
    `${evaluation.waivers} waiver(s) read across ${evaluation.inspected} inspected of ` +
    `${evaluation.classified} classified file(s) (${skipped} skipped${detail}), ` +
    `${evaluation.expiringSoon} expiring within ${WARN_WINDOW_DAYS} days ` +
    `(${kinds["cargo-audit"]} cargo-audit, ${kinds["cargo-deny"]} cargo-deny, ` +
    `${kinds["osv-scanner"]} osv-scanner, ${kinds["audit-command"]} audit-command, ` +
    `${kinds["other-text"]} other-text source(s))`
  );
}
