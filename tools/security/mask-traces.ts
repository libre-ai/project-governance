/**
 * Trace masking before publication (brick EXP-12, lot L7 of the
 * open-code-review drill, 2026-11-23).
 *
 * A trace published by this repository — the raw records of the trust bench
 * under `verification/trust-bench/resultats/`, which carry the tail of every
 * command a layer ran and the reasoning a model wrote — can hold what a
 * machine printed: a token, an environment secret, an address, a home
 * directory naming its account, a public address. This tool masks a BATCH of
 * such documents before they are versioned, and reverifies the result with
 * instruments it does not share code with.
 *
 * Two defects of the inspected upstream (`safeagents` scrub, read on
 * 2026-11-23, method rewritten, no line copied) are what this file is shaped
 * against:
 *
 * - F-G4, scope. A value found once must be masked wherever it appears. The
 *   upstream collected known values per file, so a secret found by context in
 *   one file stayed bare in the next. Here discovery runs over the whole batch
 *   first, then every document is masked with every value found anywhere.
 * - F-G5, reverification. The upstream re-scanned its output with the same
 *   scrubber, which measures idempotence, not completeness. Here the masked
 *   batch goes through three other instruments: the repository's credential
 *   scanner (`check-secret-scan`), its personal-data scanner
 *   (`check-personal-data-boundary`), and a literal search of every known
 *   value, raw and JSON-escaped, over the serialized bytes.
 *
 * Formats: `.json` is parsed, every string (keys included) masked, and
 * re-serialized, so the output is valid JSON; `.jsonl` and `.ndjson` the same
 * per line; anything else is masked as text. A document with nothing to mask
 * is returned byte for byte. An unparsable JSON document, two keys masked to
 * the same name, a provided value shorter than 8 characters, or (on the
 * command line) a file that cannot be read fails the whole batch: nothing is
 * written.
 *
 * Limits, said so that silence is not read as proof: no IPv6, no name of a
 * person written in prose, no identifier outside the families below; the
 * account name of a home directory is masked where the path shows it, not
 * propagated (a short account name such as `t` or `runner` would erase
 * ordinary words).
 *
 * Usage: bun tools/security/mask-traces.ts --out <new directory>
 *          [--secret-env NAME]... <file>...
 * The output directory must not exist: inputs are never overwritten. Values
 * are never printed, only counts.
 */

import { scanPersonalIdentifiers } from "../quality/check-personal-data-boundary";
import { containsCredentialMarker } from "../quality/public-source-scanner";

export interface TraceDocument {
  readonly path: string;
  readonly content: string;
}

export interface KnownValue {
  readonly family: string;
  readonly value: string;
}

export interface MaskFailure {
  readonly path: string;
  readonly reason: string;
}

export interface Redaction {
  readonly path: string;
  readonly family: string;
  readonly count: number;
}

export interface MaskedBatch {
  /** Empty whenever `failures` is not: a batch is masked whole or not at all. */
  readonly documents: readonly TraceDocument[];
  readonly failures: readonly MaskFailure[];
  readonly redactions: readonly Redaction[];
  /** Every value masked by value across the batch. Never printed. */
  readonly known: readonly KnownValue[];
}

export const MINIMUM_SECRET_LENGTH = 8;

type DocumentKind = "json" | "jsonl" | "text";

function kindOf(path: string): DocumentKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return "jsonl";
  return "text";
}

function placeholder(family: string): string {
  return `[REDACTED:${family}]`;
}

/**
 * Families whose value, once found, is masked across the batch. `group` names
 * the capture holding the value when the match also holds its context.
 */
const DISCOVERED_FAMILIES: ReadonlyArray<{ family: string; pattern: RegExp; group?: number }> = [
  {
    family: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { family: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    family: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/g,
  },
  { family: "gitlab-token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { family: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { family: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { family: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { family: "api-key", pattern: /\b(?:sk|hf)[-_][A-Za-z0-9_-]{20,}/g },
  {
    family: "email",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  },
  {
    family: "credential-assignment",
    pattern:
      /(?:api[_-]?key|access[_-]?key|password|passwd|secret|token)\s*[:=]\s*['"]?([^\s'"[\]]{8,})/gi,
    group: 1,
  },
];

/** Masked where they match, never propagated (see the limits above). */
const HOME_PATTERNS: readonly RegExp[] = [
  /(?<=\/(?:Users|home)\/)[^/\s"'`:\\]+/g,
  /(?<=\b[A-Za-z]:\\Users\\)[^\\\s"'`:]+/g,
];

const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g;

/** Not a public address: private, loopback, link-local, shared, multicast, reserved. */
function isNonPublic(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function maskAddresses(text: string, count: (family: string) => void): string {
  return text.replace(IPV4, (match, ...groups: unknown[]) => {
    const octets = groups.slice(0, 4).map((group) => Number(group));
    if (octets.some((octet) => octet > 255) || isNonPublic(octets)) return match;
    count("ipv4");
    return placeholder("ipv4");
  });
}

/** Every string of a document as masking will see it: decoded, keys included. */
function stringsOf(kind: DocumentKind, content: string): string[] {
  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null) {
      for (const [key, inner] of Object.entries(value)) {
        strings.push(key);
        walk(inner);
      }
    }
  };
  if (kind === "json") walk(JSON.parse(content));
  else if (kind === "jsonl") {
    for (const line of content.split("\n")) if (line.trim() !== "") walk(JSON.parse(line));
  } else strings.push(content);
  return strings;
}

function discover(text: string, into: Map<string, string>): void {
  for (const { family, pattern, group } of DISCOVERED_FAMILIES) {
    for (const match of text.matchAll(pattern)) {
      const value = group === undefined ? match[0] : match[group];
      if (value !== undefined && value.length > 0 && !into.has(value)) into.set(value, family);
    }
  }
}

class KeyCollision extends Error {}

/**
 * Mask one string: known values first, longest first so a value that contains
 * another is replaced whole, then home directories and public addresses.
 */
function maskString(
  text: string,
  known: readonly KnownValue[],
  count: (family: string) => void,
): string {
  let current = text;
  for (const { family, value } of known) {
    const parts = current.split(value);
    if (parts.length > 1) {
      for (let index = 1; index < parts.length; index += 1) count(family);
      current = parts.join(placeholder(family));
    }
  }
  for (const pattern of HOME_PATTERNS) {
    current = current.replace(pattern, () => {
      count("home");
      return placeholder("home");
    });
  }
  return maskAddresses(current, count);
}

function maskValue(value: unknown, mask: (text: string) => string): unknown {
  if (typeof value === "string") return mask(value);
  if (Array.isArray(value)) return value.map((inner) => maskValue(inner, mask));
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      const maskedKey = mask(key);
      if (Object.hasOwn(result, maskedKey)) {
        throw new KeyCollision(
          `two keys mask to the same name ${maskedKey}: masking would merge them`,
        );
      }
      result[maskedKey] = maskValue(inner, mask);
    }
    return result;
  }
  return value;
}

function maskDocument(
  document: TraceDocument,
  known: readonly KnownValue[],
  count: (family: string) => void,
): string {
  const kind = kindOf(document.path);
  let changed = false;
  const mask = (text: string): string => {
    const result = maskString(text, known, count);
    if (result !== text) changed = true;
    return result;
  };
  if (kind === "text") return mask(document.content);
  if (kind === "jsonl") {
    return document.content
      .split("\n")
      .map((line) => {
        if (line.trim() === "") return line;
        changed = false;
        const result = JSON.stringify(maskValue(JSON.parse(line), mask));
        return changed ? result : line;
      })
      .join("\n");
  }
  const result = maskValue(JSON.parse(document.content), mask);
  if (!changed) return document.content;
  const trailing = document.content.endsWith("\n") ? "\n" : "";
  return `${JSON.stringify(result, null, 2)}${trailing}`;
}

/** Mask a batch of documents. Pure: no file, no environment, no output. */
export function maskBatch(
  documents: readonly TraceDocument[],
  options: { readonly secretValues: readonly string[] },
): MaskedBatch {
  const refuse = (failures: MaskFailure[]): MaskedBatch => ({
    documents: [],
    failures,
    redactions: [],
    known: [],
  });
  if (options.secretValues.some((value) => value.length < MINIMUM_SECRET_LENGTH)) {
    return refuse([
      {
        path: "(secret values)",
        reason: `a provided secret value is shorter than ${MINIMUM_SECRET_LENGTH} characters`,
      },
    ]);
  }

  // Pass 1, over the whole batch: every value to mask by value.
  const found = new Map<string, string>();
  for (const value of options.secretValues) found.set(value, "secret-env");
  const failures: MaskFailure[] = [];
  for (const document of documents) {
    try {
      for (const text of stringsOf(kindOf(document.path), document.content)) discover(text, found);
    } catch (error) {
      failures.push({
        path: document.path,
        reason: `not valid ${kindOf(document.path).toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  if (failures.length > 0) return refuse(failures);
  const known: KnownValue[] = [...found.entries()]
    .map(([value, family]) => ({ family, value }))
    .sort((left, right) => right.value.length - left.value.length);

  // Pass 2: every document masked with every value of the batch.
  const masked: TraceDocument[] = [];
  const redactions: Redaction[] = [];
  for (const document of documents) {
    const counts = new Map<string, number>();
    const count = (family: string): void => {
      counts.set(family, (counts.get(family) ?? 0) + 1);
    };
    try {
      masked.push({ path: document.path, content: maskDocument(document, known, count) });
    } catch (error) {
      failures.push({
        path: document.path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    for (const [family, total] of counts)
      redactions.push({ path: document.path, family, count: total });
  }
  if (failures.length > 0) return refuse(failures);
  return { documents: masked, failures: [], redactions, known };
}

export interface ReverifyFinding {
  readonly path: string;
  readonly line: number;
  readonly instrument: "credential scanner" | "personal-data scanner" | "literal search";
}

export interface ReverifyReport {
  readonly findings: readonly ReverifyFinding[];
  /** Documents each instrument examined: every one, or the run is a failure. */
  readonly examined: { credential: number; personal: number; literal: number };
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

/**
 * Three instruments that share no code with the masker. The documents are
 * handed to the two scanners under neutral paths: both exempt some paths of
 * this repository (fixtures, evidence directories), and a masked trace must
 * not inherit an exemption from the name it will be published under.
 */
export function reverifyBatch(
  documents: readonly TraceDocument[],
  known: readonly KnownValue[],
): ReverifyReport {
  const findings: ReverifyFinding[] = [];
  const neutral = documents.map((document, index) => ({
    path: `masked-trace-${index}.txt`,
    content: document.content,
  }));

  documents.forEach((document, index) => {
    document.content.split("\n").forEach((line, lineIndex) => {
      if (containsCredentialMarker(line)) {
        findings.push({
          path: document.path,
          line: lineIndex + 1,
          instrument: "credential scanner",
        });
      }
    });
    for (const finding of scanPersonalIdentifiers([neutral[index] as TraceDocument])) {
      findings.push({
        path: document.path,
        line: finding.line ?? 0,
        instrument: "personal-data scanner",
      });
    }
    for (const { value } of known) {
      for (const form of new Set([value, JSON.stringify(value).slice(1, -1)])) {
        const at = document.content.indexOf(form);
        if (at !== -1) {
          findings.push({
            path: document.path,
            line: lineOf(document.content, at),
            instrument: "literal search",
          });
        }
      }
    }
  });
  const unique = findings.filter(
    (finding, index) =>
      findings.findIndex(
        (other) =>
          other.path === finding.path &&
          other.line === finding.line &&
          other.instrument === finding.instrument,
      ) === index,
  );
  return {
    findings: unique,
    examined: {
      credential: documents.length,
      personal: documents.length,
      literal: documents.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Command line

interface Arguments {
  readonly out: string;
  readonly secretNames: readonly string[];
  readonly files: readonly string[];
}

function parseArguments(argv: readonly string[]): Arguments | string {
  let out: string | null = null;
  const secretNames: string[] = [];
  const files: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--out" || argument === "--secret-env") {
      const value = argv[index + 1];
      if (value === undefined) return `${argument} needs a value`;
      if (argument === "--out") out = value;
      else secretNames.push(value);
      index += 1;
    } else if (argument.startsWith("--")) {
      return `unknown option ${argument}`;
    } else {
      files.push(argument);
    }
  }
  if (out === null) return "--out <new directory> is required";
  if (files.length === 0) return "no file to mask";
  return { out, secretNames, files };
}

async function main(): Promise<number> {
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const { dirname, isAbsolute, join, normalize } = await import("node:path");
  const fail = (message: string): number => {
    console.error(`Trace masking: ${message}`);
    return 2;
  };

  const parsed = parseArguments(process.argv.slice(2));
  if (typeof parsed === "string") {
    return fail(
      `${parsed}. Usage: mask-traces.ts --out <new directory> [--secret-env NAME]... <file>...`,
    );
  }
  if (existsSync(parsed.out)) return fail(`${parsed.out} exists: the output directory must be new`);

  const secretValues: string[] = [];
  for (const name of parsed.secretNames) {
    const value = process.env[name];
    if (value === undefined || value === "") {
      return fail(
        `secret variable ${name} is unset or empty: an unread source is not an empty one`,
      );
    }
    secretValues.push(value);
  }

  const documents: TraceDocument[] = [];
  const unread: string[] = [];
  for (const path of parsed.files) {
    const relative = normalize(path);
    if (isAbsolute(relative) || relative.startsWith("..")) {
      unread.push(`${path}: give a path inside the working directory`);
      continue;
    }
    try {
      const bytes = readFileSync(relative);
      documents.push({
        path: relative,
        content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      });
    } catch (error) {
      unread.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (unread.length > 0)
    return fail(`${unread.length} file(s) not read, nothing written:\n  ${unread.join("\n  ")}`);

  const batch = maskBatch(documents, { secretValues });
  if (batch.failures.length > 0) {
    return fail(
      `nothing written:\n  ${batch.failures.map((failure) => `${failure.path}: ${failure.reason}`).join("\n  ")}`,
    );
  }
  const report = reverifyBatch(batch.documents, batch.known);
  if (report.findings.length > 0) {
    return fail(
      `the masked batch still holds ${report.findings.length} finding(s), nothing written:\n  ` +
        report.findings
          .map((finding) => `${finding.path}:${finding.line} (${finding.instrument})`)
          .join("\n  "),
    );
  }

  for (const document of batch.documents) {
    const target = join(parsed.out, document.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, document.content);
  }

  const kinds = { json: 0, jsonl: 0, text: 0 };
  for (const document of documents) kinds[kindOf(document.path)] += 1;
  const families = new Map<string, number>();
  for (const { family, count } of batch.redactions)
    families.set(family, (families.get(family) ?? 0) + count);
  const discovered = batch.known.filter((value) => value.family !== "secret-env").length;
  const total = [...families.values()].reduce((sum, count) => sum + count, 0);
  console.log(
    `Trace masking: ${documents.length} file(s) read (json=${kinds.json} jsonl=${kinds.jsonl} text=${kinds.text}), ` +
      `${batch.known.length} known value(s) (secret-env=${secretValues.length} discovered=${discovered}), ` +
      `${total} redaction(s)${total > 0 ? `: ${[...families].map(([family, count]) => `${family}=${count}`).join(" ")}` : ""}; ` +
      `reverified by credential scanner (${report.examined.credential} file(s)), personal-data scanner ` +
      `(${report.examined.personal} file(s)), literal search of ${batch.known.length} value(s): 0 finding(s); ` +
      `written to ${parsed.out}`,
  );
  return 0;
}

if (import.meta.main) process.exit(await main());
