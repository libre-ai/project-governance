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
//   - `expires=YYYY-MM-DD`, a real calendar date;
//   - `ref=<record>`, a repository-relative path that exists, or an https URL;
//   - a justification: free text once the two tokens above are removed.
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
//   Tier 1 — a pure function of the committed files. Missing id, missing or
//   malformed date, missing or unresolved ref, missing justification, missing
//   or malformed anchor, an entry already lapsed at the anchor, an entry dated
//   beyond the horizon, and the same id waived with different dates in two
//   files. A tree that passes tier 1 cannot turn red on these rules without a
//   commit.
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
// whose ignore list two independent readings disagree on, is a defect — never
// zero waivers. "This file waives nothing" and "this file could not be read"
// must not produce the same trace (gate-integrity §2).

export const HORIZON_DAYS = 365;
export const WARN_WINDOW_DAYS = 30;

export type WaiverSourceKind = "cargo-audit" | "cargo-deny" | "osv-scanner" | "audit-command";

export interface WaiverEntry {
  readonly file: string;
  readonly line: number;
  readonly id: string | null;
  /** The text the metadata is read from: the line's comment, plus a table `reason`. */
  readonly metadata: string;
}

export interface SourceReading {
  readonly file: string;
  readonly kind: WaiverSourceKind;
  readonly entries: readonly WaiverEntry[];
  readonly anchor: string | null;
  /** Non-null when the source could not be read or parsed. Never counted as zero. */
  readonly error: string | null;
}

export type DefectCode =
  | "UNREADABLE"
  | "UNPARSEABLE"
  | "NO-ID"
  | "UNDATED"
  | "MALFORMED-DATE"
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
  readonly files: number;
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
  /** Whether a repository-relative ref names a tracked file or directory. */
  readonly refExists: (ref: string) => boolean;
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

const EXPIRES_TOKEN = /expires=(\S*?)(?=[;,\s"]|$)/;
const REF_TOKEN = /ref=([^;,\s"]+)/;
const ANCHOR_LINE = /#\s*waiver-review-anchor:\s*(\S+)/;

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
    .replace(/expires=\S*?(?=[;,\s"]|$)/g, " ")
    .replace(/ref=[^;,\s"]+/g, " ")
    .replace(/\breason\s*=/g, " ")
    .replace(/[#;,"'{}=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { expires, ref, justification };
}

export function readAnchor(text: string): string | null {
  for (const line of text.split("\n")) {
    const match = ANCHOR_LINE.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

// ------------------------------------------------------------------ classification

/**
 * Which waiver mechanism a tracked path is, or null.
 *
 * Audit commands are looked for where a command line lives: workflows, package
 * manifests and shell scripts. `bun audit --ignore=<id>` and `cargo audit
 * --ignore <id>` waive an advisory exactly as an ignore list does.
 */
export function classifySource(path: string): WaiverSourceKind | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (path === ".cargo/audit.toml" || path.endsWith("/.cargo/audit.toml")) return "cargo-audit";
  if (name === "deny.toml") return "cargo-deny";
  if (name === "osv-scanner.toml") return "osv-scanner";
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return "audit-command";
  if (name === "package.json" || name.endsWith(".sh")) return "audit-command";
  return null;
}

// ------------------------------------------------------------------ cargo ignore lists

interface RawIgnoreEntry {
  readonly id: string | null;
  readonly line: number;
  readonly metadata: string;
}

interface RawIgnoreScan {
  readonly found: boolean;
  readonly entries: readonly RawIgnoreEntry[];
  readonly error: string | null;
}

/**
 * Character-level reading of `[advisories] ignore = [ ... ]`.
 *
 * TOML comments are where the metadata lives, and a TOML parser discards them,
 * so the entries are read here from the text. The result is then reconciled
 * against `Bun.TOML.parse` (see `readCargoIgnoreSource`): two readings that
 * disagree on the list mean one of them is blind to an entry.
 */
export function scanIgnoreArray(text: string): RawIgnoreScan {
  const lines = text.split("\n");
  let section = "";
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(raw);
    if (header?.[1] !== undefined) {
      section = header[1];
      continue;
    }
    if (section !== "advisories") continue;
    const start = /^\s*ignore\s*=\s*\[/.exec(raw);
    if (start === null) continue;
    return scanArrayFrom(lines, index, start[0].length);
  }
  return { found: false, entries: [], error: null };
}

function scanArrayFrom(lines: readonly string[], firstLine: number, firstColumn: number) {
  const entries: { id: string | null; line: number; reason: string }[] = [];
  const comments = new Map<number, string>();
  let depth = 0;
  let table: { id: string | null; line: number; reason: string } | null = null;
  let pendingKey = "";

  for (let index = firstLine; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    let column = index === firstLine ? firstColumn : 0;
    while (column < raw.length) {
      const char = raw[column];
      if (char === "#") {
        comments.set(index, raw.slice(column + 1));
        break;
      }
      if (char === '"' || char === "'") {
        const closing = findStringEnd(raw, column);
        if (closing === -1) {
          return { found: true, entries: [], error: `unterminated string on line ${index + 1}` };
        }
        const value = raw.slice(column + 1, closing);
        if (depth === 0) {
          entries.push({ id: value === "" ? null : value, line: index + 1, reason: "" });
        } else if (table !== null) {
          if (pendingKey === "id") table.id = value === "" ? null : value;
          if (pendingKey === "reason") table.reason = value;
        }
        column = closing + 1;
        continue;
      }
      if (char === "{") {
        depth += 1;
        table = { id: null, line: index + 1, reason: "" };
      } else if (char === "}") {
        depth -= 1;
        if (table !== null) entries.push({ id: table.id, line: table.line, reason: table.reason });
        table = null;
      } else if (char === "]" && depth === 0) {
        // `ignore = ["A", "B"] # ...`: the comment sits after the bracket.
        const rest = raw.slice(column + 1);
        const hash = rest.indexOf("#");
        if (hash !== -1) comments.set(index, rest.slice(hash + 1));
        return {
          found: true,
          entries: entries.map((entry) => ({
            id: entry.id,
            line: entry.line,
            metadata: `${entry.reason} ${comments.get(entry.line - 1) ?? ""}`.trim(),
          })),
          error: null,
        };
      } else if (depth > 0 && /[A-Za-z_]/.test(char ?? "")) {
        const key = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(raw.slice(column))?.[0] ?? "";
        pendingKey = key;
        column += key.length;
        continue;
      }
      column += 1;
    }
  }
  return { found: true, entries: [], error: "the ignore array is never closed" };
}

function findStringEnd(raw: string, open: number): number {
  const quote = raw[open];
  for (let column = open + 1; column < raw.length; column += 1) {
    if (quote === '"' && raw[column] === "\\") {
      column += 1;
      continue;
    }
    if (raw[column] === quote) return column;
  }
  return -1;
}

function parsedIgnoreIds(text: string): { ids: (string | null)[]; error: string | null } {
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(text);
  } catch (error) {
    return { ids: [], error: `not valid TOML: ${(error as Error).message.split("\n")[0]}` };
  }
  const advisories = (parsed as Record<string, unknown>).advisories;
  if (advisories === undefined) return { ids: [], error: null };
  if (typeof advisories !== "object" || advisories === null) {
    return { ids: [], error: "`advisories` is not a table" };
  }
  const ignore = (advisories as Record<string, unknown>).ignore;
  if (ignore === undefined) return { ids: [], error: null };
  if (!Array.isArray(ignore)) return { ids: [], error: "`advisories.ignore` is not an array" };
  const ids = ignore.map((entry: unknown) => {
    if (typeof entry === "string") return entry === "" ? null : entry;
    if (typeof entry === "object" && entry !== null) {
      const id = (entry as Record<string, unknown>).id;
      return typeof id === "string" && id !== "" ? id : null;
    }
    return null;
  });
  return { ids, error: null };
}

/** `.cargo/audit.toml` and `deny.toml`: `[advisories] ignore = [...]`. */
export function readCargoIgnoreSource(
  file: string,
  kind: "cargo-audit" | "cargo-deny",
  text: string,
): SourceReading {
  const parsed = parsedIgnoreIds(text);
  if (parsed.error !== null) {
    return { file, kind, entries: [], anchor: null, error: parsed.error };
  }
  const scan = scanIgnoreArray(text);
  if (scan.error !== null) {
    return { file, kind, entries: [], anchor: null, error: scan.error };
  }
  const rawIds = scan.entries.map((entry) => entry.id ?? "").sort();
  const tomlIds = parsed.ids.map((id) => id ?? "").sort();
  if (rawIds.join("\n") !== tomlIds.join("\n")) {
    return {
      file,
      kind,
      entries: [],
      anchor: null,
      error:
        `the line reading found ${rawIds.length} ignore entr(y/ies) and the TOML parser ` +
        `${tomlIds.length}; one reading is blind to an entry (a dotted \`advisories.ignore\` key ` +
        "or an unusual layout) — write the list as `[advisories]` then `ignore = [` one entry per line",
    };
  }
  return {
    file,
    kind,
    entries: scan.entries.map((entry) => ({ file, ...entry })),
    anchor: readAnchor(text),
    error: null,
  };
}

// ------------------------------------------------------------------ osv-scanner

/**
 * `osv-scanner.toml`: one `[[IgnoredVulns]]` table per waiver.
 *
 * Read from the text, not with Bun.TOML: osv-scanner writes `ignoreUntil` as a
 * bare TOML date, which Bun's parser rejects (measured on Bun 1.4.0-canary.1:
 * `d = 2026-09-30` → "Expected key but found -"). A parser that cannot read a
 * valid file would turn it into an UNPARSEABLE red for a non-defect.
 *
 * `ignoreUntil` is the native expiry and is read as `expires`; `ref=` and the
 * justification live in `reason`.
 */
export function readOsvSource(file: string, text: string): SourceReading {
  const lines = text.split("\n");
  const entries: WaiverEntry[] = [];
  let current: { line: number; id: string | null; until: string | null; reason: string } | null =
    null;
  let inIgnored = false;
  const flush = () => {
    if (current === null) return;
    const until = current.until === null ? "" : ` expires=${current.until}`;
    entries.push({ file, line: current.line, id: current.id, metadata: `${current.reason}${until}` });
    current = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const raw = (lines[index] ?? "").trim();
    if (raw === "" || raw.startsWith("#")) continue;
    if (raw.startsWith("[")) {
      flush();
      inIgnored = /^\[\[\s*IgnoredVulns\s*\]\]$/.test(raw.replace(/\s*#.*$/, ""));
      if (inIgnored) current = { line: index + 1, id: null, until: null, reason: "" };
      continue;
    }
    if (!inIgnored || current === null) continue;
    const pair = /^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)$/.exec(raw);
    if (pair === null) {
      return {
        file,
        kind: "osv-scanner",
        entries: [],
        anchor: null,
        error: `line ${index + 1} inside [[IgnoredVulns]] is not a key = value pair`,
      };
    }
    const key = pair[1];
    const value = (pair[2] ?? "").replace(/\s+#.*$/, "").trim();
    const unquoted = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (key === "id") current.id = unquoted === "" ? null : unquoted;
    // A TOML datetime (`2026-09-30T00:00:00Z`) expires on its calendar date.
    if (key === "ignoreUntil") current.until = unquoted.slice(0, 10);
    if (key === "reason") current.reason = unquoted;
  }
  flush();
  return { file, kind: "osv-scanner", entries, anchor: readAnchor(text), error: null };
}

// ------------------------------------------------------------------ audit commands

const AUDIT_COMMAND = /\b(?:bun\s+audit|bunx?\s+audit|cargo[\s-]+audit)\b/;
const IGNORE_FLAG = /--ignore(?:=|\s+)(["']?)([^\s"']+)\1/g;

/**
 * `bun audit --ignore=<id>` / `cargo audit --ignore <id>` on a command line.
 *
 * The metadata is read from the same physical line, after a shell or YAML
 * `#`. A command continued with `\` cannot carry a comment on the flag's line,
 * and a package.json cannot carry a comment at all — both therefore fail as
 * UNDATED, which is the intended outcome: an exclusion that cannot say when it
 * ends belongs on a line that can.
 */
export function readAuditCommandSource(file: string, text: string): SourceReading {
  const lines = text.split("\n");
  const entries: WaiverEntry[] = [];
  let inCommand = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    if (AUDIT_COMMAND.test(raw)) inCommand = true;
    if (inCommand) {
      const hash = raw.search(/(^|\s)#/);
      const command = hash === -1 ? raw : raw.slice(0, hash);
      const comment = hash === -1 ? "" : raw.slice(hash);
      for (const match of command.matchAll(IGNORE_FLAG)) {
        for (const id of (match[2] ?? "").split(",")) {
          entries.push({ file, line: index + 1, id: id === "" ? null : id, metadata: comment });
        }
      }
    }
    if (!/\\\s*$/.test(raw)) inCommand = false;
  }
  return { file, kind: "audit-command", entries, anchor: readAnchor(text), error: null };
}

export function readSource(file: string, kind: WaiverSourceKind, text: string): SourceReading {
  if (kind === "cargo-audit" || kind === "cargo-deny") return readCargoIgnoreSource(file, kind, text);
  if (kind === "osv-scanner") return readOsvSource(file, text);
  return readAuditCommandSource(file, text);
}

export function unreadableSource(file: string, kind: WaiverSourceKind, reason: string): SourceReading {
  return { file, kind, entries: [], anchor: null, error: `could not be read: ${reason}` };
}

// ------------------------------------------------------------------ evaluation

function refResolves(ref: string, refExists: (ref: string) => boolean): boolean {
  if (/^https:\/\/\S+$/.test(ref)) return true;
  const path = ref.replace(/#.*$/, "").replace(/^\.\//, "").replace(/\/$/, "");
  if (path === "" || path.startsWith("/") || path.split("/").includes("..")) return false;
  return refExists(path);
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
  };
  let waivers = 0;
  let expiringSoon = 0;

  for (const reading of readings) {
    filesByKind[reading.kind] += 1;
    if (reading.error !== null) {
      const code = reading.error.startsWith("could not be read") ? "UNREADABLE" : "UNPARSEABLE";
      defects.push({
        code,
        where: reading.file,
        message: `${reading.kind} waiver source ${reading.error} — counted as a failure, never as zero waivers`,
      });
      continue;
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
      const metadata = readMetadata(entry.metadata);

      let expires: number | null = null;
      if (metadata.expires === null) {
        defects.push({
          code: "UNDATED",
          where: label,
          message: "carries no `expires=YYYY-MM-DD` on its line; an undated waiver is permanent",
        });
      } else {
        expires = dayNumber(metadata.expires);
        if (expires === null) {
          defects.push({
            code: "MALFORMED-DATE",
            where: label,
            message: `expires=${metadata.expires} is not a real ISO 8601 calendar date`,
          });
        }
      }

      if (metadata.ref === null) {
        defects.push({
          code: "UNREFERENCED",
          where: label,
          message: "carries no `ref=`; a date with no record behind it is a renewal with nothing to read",
        });
      } else if (!refResolves(metadata.ref, options.refExists)) {
        defects.push({
          code: "UNRESOLVED-REF",
          where: label,
          message: `ref=${metadata.ref} names no tracked file of this repository (repository-relative path or https URL expected)`,
        });
      }

      if (!/[A-Za-z]{2}/.test(metadata.justification)) {
        defects.push({
          code: "UNJUSTIFIED",
          where: label,
          message: "states no justification beside its expires= and ref= tokens",
        });
      }

      if (expires !== null && metadata.expires !== null) {
        const byFile = datesById.get(entry.id) ?? new Map<string, string[]>();
        byFile.set(metadata.expires, [...(byFile.get(metadata.expires) ?? []), where]);
        datesById.set(entry.id, byFile);

        if (anchor !== null) {
          if (expires < anchor) {
            defects.push({
              code: "LAPSED",
              where: label,
              message: `expires=${metadata.expires} predates the review anchor ${reading.anchor}; it was already expired when the list was last reviewed`,
            });
          } else if (expires - anchor > horizon) {
            defects.push({
              code: "OVER-HORIZON",
              where: label,
              message: `expires=${metadata.expires} is more than ${horizon} days past the anchor ${reading.anchor}; a waiver dated that far out is never reviewed again`,
            });
          }
        }

        if (today > expires) {
          defects.push({
            code: "EXPIRED",
            where: label,
            message: `expired on ${metadata.expires}; re-verify the advisory against the graph, then remove or renew the entry`,
          });
        } else if (expires - today <= warnWindow) {
          expiringSoon += 1;
          warnings.push(
            `${label} expires on ${metadata.expires}, in ${expires - today} day(s); re-verify it now — it becomes a failure the day after`,
          );
        }
      }

      if (defects.length === before) {
        clean.push(`${label} — expires=${metadata.expires}, ref=${metadata.ref}`);
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
    files: readings.length,
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
  return (
    `${evaluation.waivers} waiver(s) read across ${evaluation.files} file(s), ` +
    `${evaluation.expiringSoon} expiring within ${WARN_WINDOW_DAYS} days ` +
    `(${kinds["cargo-audit"]} cargo-audit, ${kinds["cargo-deny"]} cargo-deny, ` +
    `${kinds["osv-scanner"]} osv-scanner, ${kinds["audit-command"]} audit-command source(s))`
  );
}
