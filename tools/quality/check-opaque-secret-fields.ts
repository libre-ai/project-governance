import type { SecretScanTarget } from "./check-secret-scan";
import { containsCredentialMarker } from "./public-source-scanner";

/**
 * Opaque secret fields: the three detections the pattern scanner does not make.
 *
 * `containsCredentialMarker` recognises a credential by its issuer SHAPE or by
 * its POSITION in a URI authority. It never reads the NAME of the field that
 * carries a value, and it never decodes base64. So a 64-character hexadecimal
 * value under `apiKey`, a base64 blob under `credentials`, a literal under
 * `pwd` and a known token wrapped in base64 all cross it. This module adds
 * those cases, and only those: the issuer patterns stay in the scanner, which
 * `encoded-credential` queries after decoding, so the list of issuers lives in
 * exactly one place.
 *
 * WHY A SEPARATE FILE. `containsCredentialMarker` has two callers in service
 * (the tree-wide secret gate and the first-publication attestation). A pass
 * added there would change the verdict of both. This instrument is therefore
 * on demand: it is wired into no check chain and no workflow, and wiring it is
 * the owner's decision.
 *
 * A finding carries a path and a label, never the value and never the field
 * name: the report of a secret must not be a second copy of it.
 *
 * LIMITS, by construction:
 * - a secret split across two adjacent fields is not detected: a search by
 *   names and shapes does not rebuild a concatenation;
 * - base64 nested twice is decoded once only;
 * - a name and its value are read on one line, and a quoted string that sits
 *   inside another one behind escaped quotes is not read as a field;
 * - an unquoted value (`PASSWORD=...` in an environment file) is not a literal
 *   here: the pattern scanner remains the instrument for those.
 *
 * Usage: bun tools/quality/check-opaque-secret-fields.ts <file>...
 */

export type OpaqueSecretLabel =
  | "secret-named-literal"
  | "opaque-hex-field"
  | "opaque-base64-field"
  | "encoded-credential";

export interface OpaqueSecretFinding {
  readonly path: string;
  readonly label: OpaqueSecretLabel;
}

// ---------------------------------------------------------------- the data
// Every list and threshold below is data, compared case-insensitively against
// a lowercased name. Changing one is a security decision, readable in a diff.

/** Label `secret-named-literal`: a name that says the literal is a secret. */
const SECRET_LITERAL_NAME_FRAGMENTS: readonly string[] = [
  "secret",
  "password",
  "passwd",
  "pwd",
  "token",
  "apikey",
  "api_key",
  "api-key",
];

/** Labels `opaque-hex-field` and `opaque-base64-field`: an evocative name. */
const EVOCATIVE_NAME_FRAGMENTS: readonly string[] = [
  "secret",
  "cred",
  "passw",
  "pwd",
  "token",
  "private",
  "apikey",
  "api_key",
  "api-key",
  "auth",
  "bearer",
];

/** Exemption (a): the value is a reference to a vault entry, not the secret. */
const REFERENCE_VALUE_PREFIXES: readonly string[] = ["ref://"];
/** Exemption (b): the value declares itself a fingerprint. */
const FINGERPRINT_VALUE_PREFIXES: readonly string[] = ["sha256:", "fp:"];
/** Exemption (c): the name says fingerprint, even next to an evocative fragment. */
const FINGERPRINT_NAME_FRAGMENTS: readonly string[] = ["hash", "digest", "fingerprint", "checksum"];

const MIN_SECRET_LITERAL_LENGTH = 8;
const MIN_OPAQUE_HEX_LENGTH = 32;
const MIN_OPAQUE_BASE64_LENGTH = 20;
const MIN_ENCODED_CREDENTIAL_LENGTH = 24;

const HEXADECIMAL = /^[0-9A-Fa-f]+$/;
const BASE64_STANDARD = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_URL_SAFE = /^[A-Za-z0-9_-]+$/;
const DIGIT = /[0-9]/;
const UPPERCASE = /[A-Z]/;
const LOWERCASE = /[a-z]/;
/** What an unquoted name is made of (`api-key`, `db.password`, `PWD`). */
const NAME_CHARACTER = /[A-Za-z0-9_$.-]/;

// ------------------------------------------------------------ the tokenizer

interface QuotedString {
  /** Index of the opening quote. */
  readonly start: number;
  /** Index just past the closing quote. */
  readonly end: number;
  readonly value: string;
}

interface FieldName {
  readonly name: string;
  readonly quoted: boolean;
}

function closingQuote(line: string, quote: string, from: number): number {
  let at = line.indexOf(quote, from);
  while (at > 0 && line[at - 1] === "\\") at = line.indexOf(quote, at + 1);
  return at;
}

/**
 * The quoted strings of one line, left to right, in one forward pass.
 *
 * A quote with no closing twin on its line is not an opening, and that quote
 * character is then exhausted for the rest of the line: without that memory a
 * line of unmatched quotes would be rescanned once per quote.
 */
function quotedStrings(line: string): QuotedString[] {
  const found: QuotedString[] = [];
  const exhausted = new Set<string>();
  let at = 0;
  while (at < line.length) {
    const quote = line[at] ?? "";
    if ((quote !== '"' && quote !== "'") || exhausted.has(quote)) {
      at += 1;
      continue;
    }
    const close = closingQuote(line, quote, at + 1);
    if (close < 0) {
      exhausted.add(quote);
      at += 1;
      continue;
    }
    found.push({ start: at, end: close + 1, value: line.slice(at + 1, close) });
    at = close + 1;
  }
  return found;
}

function skipBlanksBackward(line: string, from: number): number {
  let at = from;
  while (at >= 0 && (line[at] === " " || line[at] === "\t")) at -= 1;
  return at;
}

/**
 * The name a quoted value is assigned to: `name = "…"` or `name: "…"`, the
 * name quoted or not. `null` when the string is not the right side of a pair.
 * The backward walk stops at the previous quoted string, so the regions walked
 * for two values never overlap.
 */
function nameBefore(
  line: string,
  strings: readonly QuotedString[],
  index: number,
): FieldName | null {
  const value = strings[index];
  if (value === undefined) return null;
  const separator = skipBlanksBackward(line, value.start - 1);
  if (line[separator] !== ":" && line[separator] !== "=") return null;
  const nameEnd = skipBlanksBackward(line, separator - 1);
  const previous = strings[index - 1];
  if (previous !== undefined && previous.end === nameEnd + 1) {
    return { name: previous.value, quoted: true };
  }
  let before = nameEnd;
  while (before >= 0 && NAME_CHARACTER.test(line[before] ?? "")) before -= 1;
  if (before === nameEnd) return null;
  return { name: line.slice(before + 1, nameEnd + 1), quoted: false };
}

// --------------------------------------------------------------- the labels

function hasFragment(name: string, fragments: readonly string[]): boolean {
  const lowered = name.toLowerCase();
  return fragments.some((fragment) => lowered.includes(fragment));
}

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function isBase64Alphabet(value: string): boolean {
  return BASE64_STANDARD.test(value) || BASE64_URL_SAFE.test(value);
}

/** A 20-letter ordinary word is base64-shaped but not opaque: demand a mix. */
function isOpaqueBase64(value: string): boolean {
  return (
    value.length >= MIN_OPAQUE_BASE64_LENGTH &&
    isBase64Alphabet(value) &&
    DIGIT.test(value) &&
    UPPERCASE.test(value) &&
    LOWERCASE.test(value)
  );
}

/**
 * The label of one name/value pair, at most one: the most specific wins
 * (hexadecimal, then base64, then the plain named literal), so one field is
 * one finding.
 */
function fieldLabel(field: FieldName, value: string): OpaqueSecretLabel | null {
  if (startsWithAny(value, REFERENCE_VALUE_PREFIXES)) return null;
  if (startsWithAny(value, FINGERPRINT_VALUE_PREFIXES)) return null;
  if (hasFragment(field.name, FINGERPRINT_NAME_FRAGMENTS)) return null;
  if (field.quoted && hasFragment(field.name, EVOCATIVE_NAME_FRAGMENTS)) {
    if (value.length >= MIN_OPAQUE_HEX_LENGTH && HEXADECIMAL.test(value)) return "opaque-hex-field";
    if (isOpaqueBase64(value)) return "opaque-base64-field";
  }
  if (
    value.length >= MIN_SECRET_LITERAL_LENGTH &&
    hasFragment(field.name, SECRET_LITERAL_NAME_FRAGMENTS)
  ) {
    return "secret-named-literal";
  }
  return null;
}

/** Printable ASCII plus tab, LF and CR: a decoded byte outside it is binary. */
function isPrintableText(decoded: string): boolean {
  for (let at = 0; at < decoded.length; at += 1) {
    const code = decoded.charCodeAt(at);
    const printable = code >= 0x20 && code <= 0x7e;
    if (!printable && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
  }
  return true;
}

/**
 * Whatever the name in front of it, a quoted base64 string that decodes to
 * text carrying a credential marker. No exemption applies: a reference prefix
 * or a fingerprint name does not make an encoded token harmless. The decision
 * on the decoded text belongs to the pattern scanner, RFC 2606 hosts included.
 */
function isEncodedCredential(value: string): boolean {
  if (value.length < MIN_ENCODED_CREDENTIAL_LENGTH || !isBase64Alphabet(value)) return false;
  let decoded: string;
  try {
    // `atob` yields one character per byte, and tolerates missing padding.
    decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    return false;
  }
  if (!isPrintableText(decoded)) return false;
  return containsCredentialMarker(decoded);
}

function labelsOf(content: string): Set<OpaqueSecretLabel> {
  const labels = new Set<OpaqueSecretLabel>();
  for (const line of content.split("\n")) {
    const strings = quotedStrings(line);
    for (let index = 0; index < strings.length; index += 1) {
      const value = strings[index]?.value ?? "";
      const field = nameBefore(line, strings, index);
      const label = field === null ? null : fieldLabel(field, value);
      if (label !== null) labels.add(label);
      if (isEncodedCredential(value)) labels.add("encoded-credential");
    }
  }
  return labels;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * Pure: no input-output, no exception on any content. One finding per path
 * and label, sorted by path then label.
 */
export function scanOpaqueSecretFields(
  targets: readonly SecretScanTarget[],
): OpaqueSecretFinding[] {
  const byPath = new Map<string, Set<OpaqueSecretLabel>>();
  for (const target of targets) {
    const labels = byPath.get(target.path) ?? new Set<OpaqueSecretLabel>();
    for (const label of labelsOf(target.content)) labels.add(label);
    byPath.set(target.path, labels);
  }
  const findings: OpaqueSecretFinding[] = [];
  for (const [path, labels] of byPath) {
    for (const label of labels) findings.push({ path, label });
  }
  return findings.sort(
    (left, right) => compareText(left.path, right.path) || compareText(left.label, right.label),
  );
}

if (import.meta.main) {
  const paths = process.argv.slice(2);
  const targets: SecretScanTarget[] = [];
  const { concludeGate, GateReport } = await import("./gate-report");
  const report = new GateReport();
  for (const path of paths) {
    try {
      targets.push({ path, content: await Bun.file(path).text() });
    } catch {
      // A file named on the command line and not read is a failure, never a
      // clean file: both would otherwise leave the same trace.
      report.check(path, false, "unreadable file");
    }
  }
  const findings = scanOpaqueSecretFields(targets);
  for (const finding of findings) report.check(finding.path, false, finding.label);
  const unreadable = paths.length - targets.length;
  const examined =
    `${targets.length} file(s) read of ${paths.length} given, ${unreadable} unreadable, ` +
    `${findings.length} finding(s)`;
  // No path given records no check at all: the report then fails as a gate
  // that asserted nothing, which is the truth.
  if (paths.length > 0 && report.violations.length === 0) {
    report.check(
      "opaque secret fields",
      true,
      `${targets.length} file(s) carry no opaque secret field and no encoded credential`,
    );
  }
  report.volume(examined);
  if (report.violations.length > 0) console.error(`Opaque secret fields examined: ${examined}`);
  concludeGate("Opaque secret fields", report);
}
