import { isIP } from "node:net";
import { domainToASCII } from "node:url";

import { DecodingMode, EntityDecoder, htmlDecodeTree } from "entities/decode";

const credentialMarker =
  /(?:sk_live_[A-Za-z0-9_-]{8,}|sk-(?:proj|svcacct)-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN (?:(?:(?:RSA|DSA|EC|OPENSSH|ENCRYPTED) )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----)/;

/**
 * The markers above match a credential by its issuer-specific SHAPE. A
 * provisioned connection string has no such shape: `postgresql://user:pw@host`
 * is a secret by POSITION — whatever sits between `//` and `@`, past a colon,
 * is a password. No vendor pattern covers it, which is why a credentialled
 * connection URI crossed every per-PR gate.
 *
 * Two deliberate exclusions keep this from firing on documentation:
 * - userinfo WITHOUT a non-empty password (`git://git@host`, `pg://user:@host`)
 *   is an identifier, not a credential; it stays on the sensitive/PII path,
 *   which already detects it;
 * - RFC 2606 reserved hosts and localhost cannot name a provisioned service, so
 *   a credential pointing at one is an example by construction. This is what
 *   lets the gates keep their own detection canaries in-tree.
 *
 * Detection scans the URI authority (same mechanics as containsUrlUserinfo)
 * instead of a positional regex: the K4 review of f49fc18 proved the regex
 * missed the empty-username form (`redis://:pw@host`, canonical for Redis) and
 * any percent-encoded `@` in the username (the Azure form), both valid RFC 3986.
 */
const documentationHost =
  /^(?:localhost|(?:[^\s.]+\.)*example\.(?:com|org|net)|(?:[^\s.]+\.)*(?:test|invalid|localhost))$/i;

function hasUriUserinfoCredential(value: string): boolean {
  for (
    let separator = value.indexOf("://");
    separator >= 0;
    separator = value.indexOf("://", separator + 3)
  ) {
    let schemeStart = separator;
    while (schemeStart > 0 && uriSchemeCharacter.test(value[schemeStart - 1] ?? ""))
      schemeStart -= 1;
    if (!asciiLetter.test(value[schemeStart] ?? "")) continue;
    const start = separator + 3;
    let end = start;
    while (end < value.length) {
      const next = nextCodePointEnd(value, end);
      if (/^[\t\n\r /?#]$/.test(value.slice(end, next))) break;
      end = next;
    }
    const authority = value.slice(start, end);
    const at = authority.lastIndexOf("@");
    if (at < 0) continue;
    const userinfo = authority.slice(0, at);
    const colon = userinfo.indexOf(":");
    if (colon < 0 || colon === userinfo.length - 1) continue;
    const hostPort = authority.slice(at + 1);
    const bracketEnd = hostPort.startsWith("[") ? hostPort.indexOf("]") : -1;
    const host = bracketEnd > 0 ? hostPort.slice(1, bracketEnd) : (hostPort.split(":")[0] ?? "");
    if (!documentationHost.test(host)) return true;
  }
  return false;
}
const asciiAtext = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]$/;
const asciiLetter = /^[A-Za-z]$/;
const uriSchemeCharacter = /^[A-Za-z0-9+.-]$/;
const whitespace = /^[\t\n\r ]$/;
const horizontalWhitespace = /^[\t ]$/;
const domainCodePoint = /^[\p{L}\p{M}\p{N}.-]$/u;
const domainBoundaryContinuation = /^[\p{L}\p{M}\p{N}_.-]$/u;
const apparentReservedDomainCodePoint = /^[A-Za-z0-9_.-]$/;
const canonicalAsciiDotAtom = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const exactRfc2606ExampleDomains = new Set(["example.com", "example.net", "example.org"]);
const textEncoder = new TextEncoder();
const maximumDecodedCodePoints = 65_536;
const emailContextLabels = new Set([
  "adresse",
  "adresse-email",
  "bcc",
  "cc",
  "contact",
  "contact-email",
  "courriel",
  "destinataire",
  "e-mail",
  "email",
  "expediteur",
  "expéditeur",
  "from",
  "mail",
  "mailto",
  "recipient",
  "reply-to",
  "sender",
  "to",
]);

interface SourceProjection {
  readonly origins: Int32Array;
  readonly raw: string;
  readonly text: string;
}

function rawSourceProjection(raw: string): SourceProjection {
  return {
    origins: Int32Array.from({ length: raw.length }, (_unused, index) => index),
    raw,
    text: raw,
  };
}

function appendProjectionSlice(
  parts: string[],
  origins: number[],
  source: SourceProjection,
  start: number,
  end: number,
): void {
  parts.push(source.text.slice(start, end));
  for (let index = start; index < end; index += 1) origins.push(source.origins[index] ?? -1);
}

function appendTransformed(parts: string[], origins: number[], transformed: string): void {
  parts.push(transformed);
  for (let index = 0; index < transformed.length; index += 1) origins.push(-1);
}

function finishProjection(
  parts: readonly string[],
  origins: readonly number[],
  raw: string,
): SourceProjection {
  return { origins: Int32Array.from(origins), raw, text: parts.join("") };
}

export function decodeSensitiveMarkers(input: string): string {
  return decodeSensitiveProjection(rawSourceProjection(input)).text;
}

function replaceProjection(
  source: SourceProjection,
  pattern: RegExp,
  replacement: (match: RegExpExecArray) => string,
): SourceProjection {
  const parts: string[] = [];
  const origins: number[] = [];
  let copiedUntil = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(source.text); match !== null; match = pattern.exec(source.text)) {
    const start = match.index;
    const end = start + match[0].length;
    appendProjectionSlice(parts, origins, source, copiedUntil, start);
    const transformed = replacement(match);
    if (transformed === match[0]) appendProjectionSlice(parts, origins, source, start, end);
    else appendTransformed(parts, origins, transformed);
    copiedUntil = end;
  }
  appendProjectionSlice(parts, origins, source, copiedUntil, source.text.length);
  return finishProjection(parts, origins, source.raw);
}

function decodePercentProjection(source: SourceProjection): SourceProjection {
  return replaceProjection(source, /(?:%[0-9a-f]{2})+/gi, (match) => {
    try {
      return decodeURIComponent(match[0]);
    } catch {
      return match[0].replace(/%([0-9a-f]{2})/gi, (_encoded, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    }
  });
}

function collapseSensitiveEncodingProjection(source: SourceProjection): SourceProjection {
  const percent = replaceProjection(source, /%(?:25)+/gi, () => "%");
  return replaceProjection(
    percent,
    /&(?:(?:amp(?:;|(?=#))|#0*38;?|#[xX]0*26;?))+(?=(?:#|[A-Za-z]))/gi,
    () => "&",
  );
}

function decodeUnicodeEscapeProjection(source: SourceProjection): SourceProjection {
  return replaceProjection(source, /%u([0-9A-Fa-f]{4})|%U([0-9A-Fa-f]{8})/g, (match) => {
    const hexadecimal = match[1] ?? match[2] ?? "";
    const codePoint = Number.parseInt(hexadecimal, 16);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match[0];
  });
}

function decodeHtmlProjection(source: SourceProjection): SourceProjection {
  const parts: string[] = [];
  const origins: number[] = [];
  let emitted = "";
  const decoder = new EntityDecoder(htmlDecodeTree, (codePoint) => {
    emitted += String.fromCodePoint(codePoint);
  });
  let copiedUntil = 0;
  let searchFrom = 0;
  for (let ampersand = source.text.indexOf("&", searchFrom); ampersand >= 0; ) {
    appendProjectionSlice(parts, origins, source, copiedUntil, ampersand);
    emitted = "";
    decoder.startEntity(DecodingMode.Legacy);
    let consumed = decoder.write(source.text, ampersand + 1);
    if (consumed < 0) {
      consumed = decoder.end();
      if (consumed > 0) appendTransformed(parts, origins, emitted);
      copiedUntil = ampersand + consumed;
      break;
    }
    if (consumed > 0) appendTransformed(parts, origins, emitted);
    copiedUntil = ampersand + consumed;
    searchFrom = consumed === 0 ? copiedUntil + 1 : copiedUntil;
    ampersand = source.text.indexOf("&", searchFrom);
  }
  appendProjectionSlice(parts, origins, source, copiedUntil, source.text.length);
  return finishProjection(parts, origins, source.raw);
}

function decodeSensitiveProjection(source: SourceProjection): SourceProjection {
  let current = source;
  for (let pass = 0; pass < 4; pass += 1) {
    const decoded = decodeHtmlProjection(
      decodeUnicodeEscapeProjection(
        decodePercentProjection(collapseSensitiveEncodingProjection(current)),
      ),
    );
    if (decoded.text === current.text) return current;
    current = decoded;
  }
  return current;
}

function normalizeProjection(source: SourceProjection): SourceProjection {
  const parts: string[] = [];
  const origins: number[] = [];
  for (let cursor = 0; cursor < source.text.length; ) {
    const end = nextCodePointEnd(source.text, cursor);
    const character = source.text.slice(cursor, end);
    const normalized = character.normalize("NFKC");
    const replacement =
      (character.codePointAt(0) ?? 0) >= 0x80 && /^[\t\n\r ]+$/.test(normalized)
        ? character
        : normalized;
    if (replacement === character) appendProjectionSlice(parts, origins, source, cursor, end);
    else appendTransformed(parts, origins, replacement);
    cursor = end;
  }
  return finishProjection(parts, origins, source.raw);
}

function removeDefaultIgnorablesProjection(source: SourceProjection): SourceProjection {
  const parts: string[] = [];
  const origins: number[] = [];
  for (let cursor = 0; cursor < source.text.length; ) {
    const end = nextCodePointEnd(source.text, cursor);
    if (!/^\p{Default_Ignorable_Code_Point}$/u.test(source.text.slice(cursor, end)))
      appendProjectionSlice(parts, origins, source, cursor, end);
    cursor = end;
  }
  return finishProjection(parts, origins, source.raw);
}

function previousCodePointStart(value: string, end: number): number {
  const previous = end - 1;
  const low = value.charCodeAt(previous);
  if (low >= 0xdc00 && low <= 0xdfff && previous > 0) {
    const high = value.charCodeAt(previous - 1);
    if (high >= 0xd800 && high <= 0xdbff) return previous - 1;
  }
  return previous;
}

function nextCodePointEnd(value: string, start: number): number {
  const codePoint = value.codePointAt(start);
  return start + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
}

function codePointSlice(value: string, start: number, end: number): string {
  return value.slice(start, end);
}

function isWhitespaceAt(value: string, start: number, end: number): boolean {
  return whitespace.test(codePointSlice(value, start, end));
}

function isAtextAt(value: string, start: number, end: number): boolean {
  const character = codePointSlice(value, start, end);
  const codePoint = value.codePointAt(start);
  return asciiAtext.test(character) || (codePoint !== undefined && codePoint >= 0x80);
}

function isHardLineBoundaryAt(value: string, start: number): boolean {
  if (value.charCodeAt(start) === 0x0d)
    return (
      value.charCodeAt(start + 1) !== 0x0a || !horizontalWhitespace.test(value[start + 2] ?? "")
    );
  if (value.charCodeAt(start) === 0x0a)
    return (
      value.charCodeAt(start - 1) !== 0x0d || !horizontalWhitespace.test(value[start + 1] ?? "")
    );
  return false;
}

function appendKeptOrHardBoundary(
  parts: string[],
  origins: number[],
  source: SourceProjection,
  start: number,
  end: number,
  kept: boolean,
): void {
  if (kept || isHardLineBoundaryAt(source.text, start))
    appendProjectionSlice(parts, origins, source, start, end);
}

function removeEmailComments(source: SourceProjection): SourceProjection {
  const parts: string[] = [];
  const origins: number[] = [];
  const value = source.text;
  let commentDepth = 0;
  let quoted = false;
  let escaped = false;
  for (let cursor = 0; cursor < value.length; ) {
    const end = nextCodePointEnd(value, cursor);
    const character = value.slice(cursor, end);
    if (commentDepth > 0) {
      appendKeptOrHardBoundary(parts, origins, source, cursor, end, false);
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "(") commentDepth += 1;
      else if (character === ")") commentDepth -= 1;
      cursor = end;
      continue;
    }
    if (quoted) {
      appendProjectionSlice(parts, origins, source, cursor, end);
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      cursor = end;
      continue;
    }
    if (character === "(") commentDepth = 1;
    else {
      appendProjectionSlice(parts, origins, source, cursor, end);
      if (character === '"') quoted = true;
    }
    cursor = end;
  }
  return finishProjection(parts, origins, source.raw);
}

function projectEmailContextWithoutComments(source: SourceProjection): SourceProjection {
  const value = source.text;
  const removalDeltas = new Int32Array(value.length + 1);
  const removedDelimiters = new Uint8Array(value.length);
  const frames: Array<{ start: number; containsAt: boolean }> = [];

  const removeRange = (start: number, end: number): void => {
    removalDeltas[start] = (removalDeltas[start] ?? 0) + 1;
    removalDeltas[end] = (removalDeltas[end] ?? 0) - 1;
  };

  for (let cursor = 0; cursor < value.length; ) {
    const end = nextCodePointEnd(value, cursor);
    const character = value.slice(cursor, end);
    if (character === "\\" && frames.length > 0 && end < value.length) {
      const escapedEnd = nextCodePointEnd(value, end);
      const frame = frames.at(-1);
      if (frame !== undefined && value.slice(end, escapedEnd) === "@") frame.containsAt = true;
      cursor = escapedEnd;
      continue;
    }
    if (character === "(") frames.push({ start: cursor, containsAt: false });
    else if (character === ")") {
      const frame = frames.pop();
      if (frame === undefined) removedDelimiters[cursor] = 1;
      else if (frame.containsAt) {
        removedDelimiters[frame.start] = 1;
        removedDelimiters[cursor] = 1;
        const parent = frames.at(-1);
        if (parent !== undefined) parent.containsAt = true;
      } else removeRange(frame.start, end);
    } else if (character === "@") {
      const frame = frames.at(-1);
      if (frame !== undefined) frame.containsAt = true;
    }
    cursor = end;
  }

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    if (frame.containsAt) {
      removedDelimiters[frame.start] = 1;
      const parent = frames.at(-1);
      if (parent !== undefined) parent.containsAt = true;
    } else removeRange(frame.start, value.length);
  }

  const parts: string[] = [];
  const origins: number[] = [];
  let removalDepth = 0;
  for (let cursor = 0; cursor < value.length; ) {
    removalDepth += removalDeltas[cursor] ?? 0;
    const end = nextCodePointEnd(value, cursor);
    appendKeptOrHardBoundary(
      parts,
      origins,
      source,
      cursor,
      end,
      removalDepth === 0 && removedDelimiters[cursor] !== 1,
    );
    cursor = end;
  }
  return finishProjection(parts, origins, source.raw);
}

function projectEmailContextByDirectAt(source: SourceProjection): SourceProjection {
  const value = source.text;
  type Group = {
    start: number;
    closing: number | undefined;
    end: number;
    parent: number | undefined;
    directAt: boolean;
    hasAtDescendant: boolean;
  };

  const groups: Group[] = [];
  const stack: number[] = [];
  const unmatchedClosings = new Uint8Array(value.length);
  let rootDirectAt = false;

  for (let cursor = 0; cursor < value.length; ) {
    const end = nextCodePointEnd(value, cursor);
    const character = value.slice(cursor, end);
    if (character === "\\" && stack.length > 0 && end < value.length) {
      cursor = nextCodePointEnd(value, end);
      continue;
    }
    if (character === "(") {
      const parent = stack.at(-1);
      groups.push({
        start: cursor,
        closing: undefined,
        end: value.length,
        parent,
        directAt: false,
        hasAtDescendant: false,
      });
      stack.push(groups.length - 1);
    } else if (character === ")") {
      const index = stack.pop();
      const group = index === undefined ? undefined : groups[index];
      if (group === undefined) unmatchedClosings[cursor] = 1;
      else {
        group.closing = cursor;
        group.end = end;
      }
    } else if (character === "@") {
      const index = stack.at(-1);
      const group = index === undefined ? undefined : groups[index];
      if (group === undefined) rootDirectAt = true;
      else group.directAt = true;
    }
    cursor = end;
  }

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === undefined) continue;
    group.hasAtDescendant = group.directAt || group.hasAtDescendant;
    if (!group.hasAtDescendant || group.parent === undefined) continue;
    const parent = groups[group.parent];
    if (parent !== undefined) parent.hasAtDescendant = true;
  }

  const removalDeltas = new Int32Array(value.length + 1);
  const removedDelimiters = new Uint8Array(value.length);
  const removeRange = (start: number, end: number): void => {
    removalDeltas[start] = (removalDeltas[start] ?? 0) + 1;
    removalDeltas[end] = (removalDeltas[end] ?? 0) - 1;
  };

  for (const group of groups) {
    const parentDirectAt =
      group.parent === undefined ? rootDirectAt : (groups[group.parent]?.directAt ?? false);
    if (parentDirectAt || !group.hasAtDescendant) removeRange(group.start, group.end);
    else {
      removedDelimiters[group.start] = 1;
      if (group.closing !== undefined) removedDelimiters[group.closing] = 1;
    }
  }

  const parts: string[] = [];
  const origins: number[] = [];
  let removalDepth = 0;
  for (let cursor = 0; cursor < value.length; ) {
    removalDepth += removalDeltas[cursor] ?? 0;
    const end = nextCodePointEnd(value, cursor);
    appendKeptOrHardBoundary(
      parts,
      origins,
      source,
      cursor,
      end,
      removalDepth === 0 && removedDelimiters[cursor] !== 1 && unmatchedClosings[cursor] !== 1,
    );
    cursor = end;
  }
  return finishProjection(parts, origins, source.raw);
}

/**
 * RFC folding whitespace is horizontal whitespace on one line, optionally
 * continued by CRLF only when the next physical line starts with SP/HTAB.
 * Bare CR/LF are document boundaries: accepting them here joins unrelated
 * Markdown lines into a synthetic address.
 */
function skipFoldingWhitespaceBackward(value: string, end: number): number {
  let cursor = end;
  while (cursor > 0) {
    let horizontalStart = cursor;
    while (horizontalStart > 0) {
      const start = previousCodePointStart(value, horizontalStart);
      if (!horizontalWhitespace.test(value.slice(start, horizontalStart))) break;
      horizontalStart = start;
    }
    const consumedHorizontal = horizontalStart < cursor;
    cursor = horizontalStart;
    if (
      !consumedHorizontal ||
      cursor < 2 ||
      value.charCodeAt(cursor - 2) !== 0x0d ||
      value.charCodeAt(cursor - 1) !== 0x0a
    )
      break;
    cursor -= 2;
  }
  return cursor;
}

function skipFoldingWhitespaceForward(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length) {
    while (cursor < value.length && horizontalWhitespace.test(value[cursor] ?? "")) cursor += 1;
    if (
      value.charCodeAt(cursor) !== 0x0d ||
      value.charCodeAt(cursor + 1) !== 0x0a ||
      !horizontalWhitespace.test(value[cursor + 2] ?? "")
    )
      break;
    cursor += 2;
  }
  return cursor;
}

function hasValidProseQuotePrefix(value: string, quote: number): boolean {
  if (quote === 0) return true;
  const previous = previousCodePointStart(value, quote);
  const character = value.slice(previous, quote);
  if (isWhitespaceAt(value, previous, quote) || "(<[{".includes(character)) return true;
  return character === ":" && hasEmailContextLabel(value, previous);
}

function findOpeningQuoteBoundaries(value: string): ReadonlySet<number> {
  const openings = new Set<number>();
  let quoted = false;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    if (!isUnescapedQuote(value, cursor)) continue;
    if (!quoted && hasValidProseQuotePrefix(value, cursor)) openings.add(cursor);
    quoted = !quoted;
  }
  return openings;
}

function hasEmailContextLabel(value: string, colon: number): boolean {
  let start = colon;
  while (start > 0) {
    const previous = previousCodePointStart(value, start);
    if (!/^[\p{L}-]$/u.test(value.slice(previous, start))) break;
    start = previous;
  }
  if (start === colon) return false;
  if (start > 0) {
    const boundary = previousCodePointStart(value, start);
    const character = value.slice(boundary, start);
    if (!isWhitespaceAt(value, boundary, start) && !"(<[{,;)".includes(character)) return false;
  }
  return emailContextLabels.has(value.slice(start, colon).toLowerCase());
}

function hasValidLocalBoundary(
  value: string,
  start: number,
  openingQuotes: ReadonlySet<number>,
): boolean {
  if (start === 0) return true;
  const previous = previousCodePointStart(value, start);
  const character = value.slice(previous, start);
  if (isWhitespaceAt(value, previous, start) || "(<[{,;:)".includes(character)) return true;
  if (character === '"') return openingQuotes.has(previous);
  return false;
}

interface EmailLocalCandidate {
  readonly end: number;
  readonly kind: "dot-atom" | "quoted";
  readonly start: number;
}

function parseDotAtomLocal(
  value: string,
  end: number,
  openingQuotes: ReadonlySet<number>,
): EmailLocalCandidate | null {
  let start = end;
  while (start > 0) {
    const previous = previousCodePointStart(value, start);
    const character = value.slice(previous, start);
    if (!(character === "." || isAtextAt(value, previous, start))) break;
    start = previous;
  }
  if (start === end || !hasValidLocalBoundary(value, start, openingQuotes)) return null;
  const candidate = value.slice(start, end);
  if (
    candidate.startsWith(".") ||
    candidate.endsWith(".") ||
    candidate.includes("..") ||
    textEncoder.encode(candidate).byteLength > 64
  )
    return null;
  return { end, kind: "dot-atom", start };
}

function isUnescapedQuote(value: string, index: number): boolean {
  if (value.charCodeAt(index) !== 0x22) return false;
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value.charCodeAt(cursor) === 0x5c; cursor -= 1)
    backslashCount += 1;
  return backslashCount % 2 === 0;
}

function isAllowedQuotedCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    codePoint === 0x20 ||
    codePoint === 0x21 ||
    (codePoint >= 0x23 && codePoint <= 0x5b) ||
    (codePoint >= 0x5d && codePoint <= 0x7e) ||
    codePoint >= 0x80
  );
}

function parseQuotedLocal(
  value: string,
  end: number,
  openingQuotes: ReadonlySet<number>,
): EmailLocalCandidate | null {
  const closingQuote = end - 1;
  if (!isUnescapedQuote(value, closingQuote)) return null;
  for (let openingQuote = closingQuote - 1; openingQuote >= 0; openingQuote -= 1) {
    if (!isUnescapedQuote(value, openingQuote)) continue;
    if (!hasValidLocalBoundary(value, openingQuote, openingQuotes)) return null;
    for (let cursor = openingQuote + 1; cursor < closingQuote; ) {
      let codePoint = value.codePointAt(cursor);
      if (codePoint === undefined) return null;
      cursor = nextCodePointEnd(value, cursor);
      if (codePoint === 0x5c) {
        if (cursor >= closingQuote) return null;
        codePoint = value.codePointAt(cursor);
        if (codePoint === undefined) return null;
        cursor = nextCodePointEnd(value, cursor);
        if (!(codePoint === 0x09 || (codePoint >= 0x20 && codePoint <= 0x7e) || codePoint >= 0x80))
          return null;
      } else if (!isAllowedQuotedCodePoint(codePoint)) return null;
    }
    return textEncoder.encode(value.slice(openingQuote, end)).byteLength <= 64
      ? { end, kind: "quoted", start: openingQuote }
      : null;
  }
  return null;
}

function isDomainDot(character: string): boolean {
  return character === "." || character === "。" || character === "．" || character === "｡";
}

function skipTrailingDomainDots(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length) {
    const end = nextCodePointEnd(value, cursor);
    if (!isDomainDot(value.slice(cursor, end))) break;
    cursor = end;
  }
  return cursor;
}

function hasValidDomainBoundary(value: string, end: number): boolean {
  if (end >= value.length) return true;
  const next = nextCodePointEnd(value, end);
  return !domainBoundaryContinuation.test(value.slice(end, next));
}

interface EmailDomainCandidate {
  readonly ascii: string | null;
  readonly end: number;
  readonly kind: "dns" | "literal";
  readonly start: number;
}

function parseDomainLiteral(value: string, start: number): EmailDomainCandidate | null {
  let closing = -1;
  const closingLimit = Math.min(value.length - 1, start + 72);
  for (let cursor = start + 1; cursor <= closingLimit; cursor += 1) {
    if (value.charCodeAt(cursor) !== 0x5d) continue;
    closing = cursor;
    break;
  }
  const boundary = closing < 0 ? closing : skipTrailingDomainDots(value, closing + 1);
  if (closing < 0 || !hasValidDomainBoundary(value, boundary)) return null;
  const literal = value.slice(start + 1, closing);
  const valid = /^IPv6:/i.test(literal) ? isIP(literal.slice(5)) === 6 : isIP(literal) === 4;
  return valid ? { ascii: null, end: closing + 1, kind: "literal", start } : null;
}

function parseDnsDomain(value: string, start: number): EmailDomainCandidate | null {
  let end = start;
  while (end < value.length) {
    const next = nextCodePointEnd(value, end);
    const character = value.slice(end, next);
    if (!(domainCodePoint.test(character) || isDomainDot(character))) break;
    end = next;
  }
  if (end === start || !hasValidDomainBoundary(value, end)) return null;
  while (end > start) {
    const previous = previousCodePointStart(value, end);
    if (!isDomainDot(value.slice(previous, end))) break;
    end = previous;
  }
  if (end === start) return null;
  const ascii = domainToASCII(value.slice(start, end));
  if (ascii.length === 0 || ascii.length > 253) return null;
  const labels = ascii.toLowerCase().split(".");
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
      return null;
  }
  const topLevel = labels.at(-1) ?? "";
  if (!(/^[a-z]{2,63}$/.test(topLevel) || /^xn--[a-z0-9-]{2,59}$/.test(topLevel))) return null;
  return { ascii: ascii.toLowerCase(), end, kind: "dns", start };
}

function parseDomain(value: string, start: number): EmailDomainCandidate | null {
  return value[start] === "[" ? parseDomainLiteral(value, start) : parseDnsDomain(value, start);
}

interface EmailCandidate {
  readonly at: number;
  readonly canonicalSeparatorBoundary: boolean;
  readonly domain: EmailDomainCandidate;
  readonly local: EmailLocalCandidate;
}

type EmailCandidatePolicy = (candidate: EmailCandidate, source: SourceProjection) => boolean;

function isRfc2606ExampleDomain(domain: string): boolean {
  return (
    exactRfc2606ExampleDomains.has(domain) ||
    domain.endsWith(".example") ||
    domain.endsWith(".invalid") ||
    domain.endsWith(".test")
  );
}

function hasCanonicalSeparatorBoundary(
  value: string,
  localStart: number,
  previousCandidateEnd: number | null,
): boolean {
  if (localStart === 0) return true;
  const separatorStart = previousCodePointStart(value, localStart);
  const separator = value.slice(separatorStart, localStart);
  if (!",;:)".includes(separator)) return true;
  if (previousCandidateEnd === separatorStart || separatorStart === 0) return true;
  if (separator === ":" && hasEmailContextLabel(value, separatorStart)) return true;
  const beforeSeparator = previousCodePointStart(value, separatorStart);
  return !domainBoundaryContinuation.test(value.slice(beforeSeparator, separatorStart));
}

function hasMalformedReservedDomain(value: string, start: number): boolean {
  let end = start;
  while (end < value.length && apparentReservedDomainCodePoint.test(value[end] ?? "")) end += 1;
  while (end > start && value[end - 1] === ".") end -= 1;
  if (end === start) return false;
  const domain = value.slice(start, end).toLowerCase();
  if (isRfc2606ExampleDomain(domain)) return true;
  if (exactRfc2606ExampleDomains.has(domain.replace(/\.{2,}/g, "."))) return true;
  const labels = domain.split(".");
  if (labels.length !== 2) return false;
  const base = (labels[0] ?? "").replace(/^-+|-+$/g, "");
  return base === "example" && ["com", "net", "org"].includes(labels[1] ?? "");
}

function containsEmailCandidate(
  source: SourceProjection,
  policy: EmailCandidatePolicy,
  malformedReservedIsSensitive: boolean,
): boolean {
  const value = source.text;
  const openingQuotes = findOpeningQuoteBoundaries(value);
  let previousCandidateEnd: number | null = null;
  for (let at = value.indexOf("@"); at >= 0; at = value.indexOf("@", at + 1)) {
    const localEnd = skipFoldingWhitespaceBackward(value, at);
    const domainStart = skipFoldingWhitespaceForward(value, at + 1);
    const local =
      parseDotAtomLocal(value, localEnd, openingQuotes) ??
      parseQuotedLocal(value, localEnd, openingQuotes);
    if (local === null) continue;
    const domain = parseDomain(value, domainStart);
    if (domain === null) {
      if (malformedReservedIsSensitive && hasMalformedReservedDomain(value, domainStart))
        return true;
      continue;
    }
    const candidate = {
      at,
      canonicalSeparatorBoundary: hasCanonicalSeparatorBoundary(
        value,
        local.start,
        previousCandidateEnd,
      ),
      domain,
      local,
    } satisfies EmailCandidate;
    previousCandidateEnd = domain.end;
    if (policy(candidate, source)) return true;
  }
  return false;
}

function containsEmailIdentifierAcrossCommentProjections(
  input: SourceProjection,
  policy: EmailCandidatePolicy,
  malformedReservedIsSensitive: boolean,
): boolean {
  if (containsEmailCandidate(input, policy, malformedReservedIsSensitive)) return true;
  const withoutComments = removeEmailComments(input);
  if (
    withoutComments.text !== input.text &&
    containsEmailCandidate(withoutComments, policy, malformedReservedIsSensitive)
  )
    return true;
  const projectedContext = projectEmailContextWithoutComments(input);
  if (
    projectedContext.text !== input.text &&
    containsEmailCandidate(projectedContext, policy, malformedReservedIsSensitive)
  )
    return true;
  const directContext = projectEmailContextByDirectAt(input);
  return (
    directContext.text !== input.text &&
    containsEmailCandidate(directContext, policy, malformedReservedIsSensitive)
  );
}

const everyEmailCandidateIsSensitive: EmailCandidatePolicy = () => true;

function isCanonicalRfc2606ExampleCandidate(
  candidate: EmailCandidate,
  source: SourceProjection,
): boolean {
  if (
    candidate.local.kind !== "dot-atom" ||
    candidate.domain.kind !== "dns" ||
    candidate.domain.ascii === null ||
    !candidate.canonicalSeparatorBoundary ||
    candidate.local.end !== candidate.at ||
    candidate.domain.start !== candidate.at + 1
  )
    return false;
  const local = source.text.slice(candidate.local.start, candidate.local.end);
  const rawDomain = source.text.slice(candidate.domain.start, candidate.domain.end);
  return (
    canonicalAsciiDotAtom.test(local) &&
    /^[A-Za-z0-9.-]+$/.test(rawDomain) &&
    isRfc2606ExampleDomain(candidate.domain.ascii)
  );
}

function hasUnchangedContiguousRawOrigin(
  candidate: EmailCandidate,
  source: SourceProjection,
): boolean {
  const start = candidate.local.start;
  const rawStart = source.origins[start] ?? -1;
  if (rawStart < 0) return false;
  for (let index = start; index < candidate.domain.end; index += 1) {
    const rawIndex = rawStart + index - start;
    if (
      source.origins[index] !== rawIndex ||
      source.text.charCodeAt(index) !== source.raw.charCodeAt(rawIndex)
    )
      return false;
  }
  return true;
}

const nonRfc2606ExampleIsSensitive: EmailCandidatePolicy = (candidate, source) =>
  !isCanonicalRfc2606ExampleCandidate(candidate, source) ||
  !hasUnchangedContiguousRawOrigin(candidate, source);

export function containsEmailIdentifier(input: string): boolean {
  return containsEmailIdentifierAcrossCommentProjections(
    rawSourceProjection(input),
    everyEmailCandidateIsSensitive,
    false,
  );
}

/**
 * Detects an email identifier while excluding only source-authored RFC 2606
 * examples in canonical ASCII dot-atom form. The raw source is required: a
 * candidate produced by decoding, Unicode normalization, default-ignorable
 * removal, or comment projection never gains the example exemption.
 */
export function containsEmailIdentifierExcludingRfc2606Examples(input: string): boolean {
  if (exceedsDecodedCodePointLimit(input)) return true;
  const raw = rawSourceProjection(input);
  if (containsEmailIdentifierAcrossCommentProjections(raw, nonRfc2606ExampleIsSensitive, true))
    return true;

  const decoded = decodeSensitiveProjection(raw);
  const normalized = normalizeProjection(decoded);
  const variants = [
    decoded,
    normalized,
    removeDefaultIgnorablesProjection(decoded),
    removeDefaultIgnorablesProjection(normalized),
  ];
  for (const variant of variants) {
    if (
      variant.text !== input &&
      containsEmailIdentifierAcrossCommentProjections(variant, nonRfc2606ExampleIsSensitive, true)
    )
      return true;
  }
  return false;
}

function exceedsDecodedCodePointLimit(value: string): boolean {
  let count = 0;
  for (const _codePoint of value) {
    count += 1;
    if (count > maximumDecodedCodePoints) return true;
  }
  return false;
}

function normalizePreservingNonAsciiCfws(value: string): string {
  let normalized = "";
  for (const character of value) {
    const replacement = character.normalize("NFKC");
    normalized +=
      (character.codePointAt(0) ?? 0) >= 0x80 && /^[\t\n\r ]+$/.test(replacement)
        ? character
        : replacement;
  }
  return normalized;
}

function containsUrlUserinfo(value: string): boolean {
  for (
    let separator = value.indexOf("://");
    separator >= 0;
    separator = value.indexOf("://", separator + 3)
  ) {
    let schemeStart = separator;
    while (schemeStart > 0 && uriSchemeCharacter.test(value[schemeStart - 1] ?? ""))
      schemeStart -= 1;
    if (!asciiLetter.test(value[schemeStart] ?? "")) continue;
    const start = separator + 3;
    let end = start;
    while (end < value.length) {
      const next = nextCodePointEnd(value, end);
      if (/^[\t\n\r /?#]$/.test(value.slice(end, next))) break;
      end = next;
    }
    const authority = value.slice(start, end);
    const at = authority.lastIndexOf("@");
    if (at > 0 && at < authority.length - 1) return true;
  }
  return false;
}

function sensitiveVariants(value: string): {
  readonly variants: Set<string>;
  readonly overLimit: boolean;
} {
  const decoded = decodeSensitiveMarkers(value);
  const normalized = normalizePreservingNonAsciiCfws(decoded);
  const overLimit =
    exceedsDecodedCodePointLimit(decoded) || exceedsDecodedCodePointLimit(normalized);
  const variants = new Set([
    decoded,
    normalized,
    decoded.replace(/\p{Default_Ignorable_Code_Point}/gu, ""),
    normalized.replace(/\p{Default_Ignorable_Code_Point}/gu, ""),
  ]);
  return { variants, overLimit };
}

export function containsSensitivePublicMarker(value: string): boolean {
  const { variants, overLimit } = sensitiveVariants(value);
  if (overLimit) return true;
  for (const variant of variants) {
    if (
      credentialMarker.test(variant) ||
      containsEmailIdentifier(variant) ||
      containsUrlUserinfo(variant)
    )
      return true;
  }
  return false;
}

/**
 * Credential-only marker (cloud keys, VCS/CI tokens, private keys) with the
 * same decoding hardening as the full sensitive scan, but WITHOUT the email or
 * URL-userinfo identifiers. The tree-wide secret gate uses this: an example
 * address in a scanner fixture is not a committed credential.
 */
export function containsCredentialMarker(value: string): boolean {
  const { variants } = sensitiveVariants(value);
  // The raw value is a variant of record: percent-encoded userinfo must be
  // seen undecoded, because decoding an encoded `@` or `/` reshapes the
  // authority and hides the credential from authority parsing.
  for (const variant of [value, ...variants]) {
    if (credentialMarker.test(variant)) return true;
    if (hasUriUserinfoCredential(variant)) return true;
  }
  return false;
}

export const publicSourceScannerSelfTests: ReadonlyArray<
  readonly [label: string, value: string, expectedSensitive: boolean]
> = [
  ["direct email", "alice@example.org", true],
  ["trailing sentence-dot email", "alice@example.org.", true],
  ["trailing Unicode-dot email", "alice@example.org。", true],
  ["trailing ellipsis email", "alice@example.org...", true],
  ["encoded trailing-dot email", "alice&commat;example&period;org&period;", true],
  ["domain-literal trailing-dot email", "alice@[127.0.0.1].", true],
  ["parenthesized email", "Contact (alice@example.org).", true],
  ["double-quoted prose email", '"alice@example.org"', true],
  ["encoded double-quoted prose email", "&quot;alice&commat;example&period;org&quot;", true],
  ["labelled quoted prose email", 'contact:"alice@example.org"', true],
  ["later valid quoted prose email", 'foo"bar" "alice@example.org"', true],
  ["contact-labelled email", "contact:alice@example.org", true],
  ["email-labelled email", "Email:alice@example.org", true],
  ["courriel-labelled email", "courriel:alice@example.org", true],
  ["encoded parenthesized email", "%28alice%40example.org%29", true],
  ["HTML parenthesized email", "&lpar;alice&commat;example&period;org&rpar;", true],
  ["mailto email", "mailto:alice@example.org", true],
  ["URL userinfo identifier", "https://user:secret@example.org/feed.xml", true],
  ["SSH userinfo identifier", "ssh://user:secret@example.org/repo.git", true],
  ["Git userinfo identifier", "git://git@example.org/repo.git", true],
  ["custom-scheme userinfo identifier", "custom+v1://user@example.org/resource", true],
  ["encoded SSH userinfo identifier", "%73%73%68%3A%2F%2Fuser%40example.org/repo", true],
  ["percent email", "alice%40example.org", true],
  ["double-percent email", "alice%2540example.org", true],
  ["JavaScript escape email", "alice%u0040example.org", true],
  ["numeric HTML email", "alice&#64;example&period;org", true],
  ["semicolonless HTML email", "alice&#64example.org", true],
  ["nested HTML email", "alice&amp;#64;example.org", true],
  ["named HTML email", "alice&commat;example&period;org", true],
  ["nested named HTML email", "alice&ampcommat;example&ampperiod;org", true],
  ["mixed nested HTML email", "alice&amp;&#38;&#64example.org", true],
  ["HTML5 Unicode local email", "&alpha;&commat;example&period;org", true],
  ["uppercase HTML5 quote alias", "&QUOT;alice&QUOT;&commat;example&period;org", true],
  ["mixed-case unknown HTML alias", "alice&CommaT;example&period;org", false],
  ["Unicode at-sign email", "alice＠example.org", true],
  ["Unicode at-sign with ASCII CFWS", "alice ＠ example.org", true],
  ["default-ignorable email", "ali\u200bce@example.org", true],
  ["Unicode local email", "élise@example.org", true],
  ["EAI symbol local email", "😀@example.org", true],
  ["percent EAI local email", "%F0%9F%98%80%40example.org", true],
  ["numeric EAI local email", "&#128512;&#64;example.org", true],
  ["private-use EAI local email", "\uE000@example.org", true],
  ["C1 EAI local email", "\u0080@example.org", true],
  ["non-ASCII space EAI local email", "\u00A0@example.org", true],
  ["unassigned EAI local email", "\u0378@example.org", true],
  ["noncharacter EAI local email", "\uFFFF@example.org", true],
  ["default-ignorable EAI local email", "\u200B@example.org", true],
  ["HTML5 default-ignorable EAI local email", "&ZeroWidthSpace;&commat;example&period;org", true],
  ["quoted local email", '"alice"@example.org', true],
  ["quoted escaped local email", '"ali\\\\ce"@example.org', true],
  ["quoted Unicode local email", '"álîçé"@example.org', true],
  ["encoded quoted local email", "&quot;alice&quot;&commat;example&period;org", true],
  ["commented local email", "alice(comment)@example.org", true],
  ["commented domain email", "alice@(comment)example.org", true],
  ["CFWS email", "alice (comment) @ example.org", true],
  ["quoted CFWS email", '"alice" (comment) @ example.org', true],
  ["encoded CFWS email", "%22alice%22%28comment%29%40example.org", true],
  ["parenthesized CFWS email", "(alice (comment) @ example.org)", true],
  ["whole-quoted CFWS email", '"alice (comment) @ example.org"', true],
  [
    "parenthesized nested escaped CFWS email",
    "(alice (outer(inner\\)x\\(y) tail) @ example.org)",
    true,
  ],
  [
    "whole-quoted nested escaped CFWS email",
    '"alice (outer(inner\\)x\\(y) tail) @ example.org"',
    true,
  ],
  [
    "parenthesized even-backslash CFWS email",
    "(alice (outer(inner\\\\) tail) @ example.org)",
    true,
  ],
  ["parenthesized at-comment CFWS email", "(alice (foo@bar) @ example.org)", true],
  ["whole-quoted at-comment CFWS email", '"alice (foo@bar) @ example.org"', true],
  ["nested-wrapper CFWS email", "((alice (comment) @ example.org))", true],
  ["email inside comment after handle", "release@2 (alice (comment) @ example.org)", true],
  ["encoded parenthesized CFWS email", "%28alice%20%28comment%29%20%40%20example.org%29", true],
  [
    "HTML whole-quoted CFWS email",
    "&quot;alice &lpar;comment&rpar; &commat; example&period;org&quot;",
    true,
  ],
  ["parenthesized EAI CFWS email", "(😀 (comment) @ example.org)", true],
  ["whole-quoted EAI CFWS email", '"😀 (comment) @ example.org"', true],
  ["parenthesized IDN CFWS email", "(alice (comment) @ example.орг)", true],
  ["whole-quoted IDN CFWS email", '"alice (comment) @ example.орг"', true],
  ["parenthesized IPv6 CFWS email", "(alice (comment) @ [IPv6:2001:db8::1])", true],
  ["whole-quoted IPv6 CFWS email", '"alice (comment) @ [IPv6:2001:db8::1]"', true],
  ["bare LF does not join email lines", "markdown\n@AGENTS.md", false],
  ["bare CR does not join email lines", "markdown\r@AGENTS.md", false],
  ["bare CRLF without WSP does not join email lines", "markdown\r\n@AGENTS.md", false],
  ["RFC folded email", "alice\r\n \t@example.org", true],
  ["parentheses in quoted local email", '"ali(ce)"@example.org', true],
  ["Unicode domain email", "alice@example.орг", true],
  ["combining-mark IDN email", "alice@e\u0301xample.org", true],
  ["punycode email", "alice@example.xn--p1ai", true],
  ["IPv4 domain literal", "alice@[127.0.0.1]", true],
  ["IPv6 domain literal", "alice@[IPv6:2001:db8::1]", true],
  ["lowercase IPv6 domain literal", "alice@[ipv6:2001:db8::1]", true],
  ["mixed-case IPv6 domain literal", "alice@[iPv6:2001:db8::1]", true],
  [
    "encoded IPv6 domain literal",
    "alice&commat;&lbrack;IPv6&colon;2001&colon;db8&colon;&colon;1&rsqb;",
    true,
  ],
  [
    "HTML5 lowercase IPv6 domain literal",
    "alice&commat;&lbrack;ipv6&colon;2001&colon;db8&colon;&colon;1&rsqb;",
    true,
  ],
  ["credential", "sk_live_example_secret", true],
  ["DSA private-key marker", "-----BEGIN DSA PRIVATE KEY-----", true],
  ["OpenPGP private-key marker", "-----BEGIN PGP PRIVATE KEY BLOCK-----", true],
  ["encrypted private-key marker", "-----BEGIN ENCRYPTED PRIVATE KEY-----", true],
  [
    "encoded DSA private-key marker",
    "%2D%2D%2D%2D%2DBEGIN%20DSA%20PRIVATE%20KEY%2D%2D%2D%2D%2D",
    true,
  ],
  ["default-ignorable credential", "sk_li\u200bve_example_secret", true],
  ["machine handle", "release@2", false],
  ["parenthesized machine handle", "(release@2)", false],
  ["quoted machine handle", '"release"@2', false],
  ["legitimate ampersand", "R&D", false],
  ["legitimate amp prefix", "R&amplitude", false],
  ["literal unresolved markers", "policy &#fragment, &CommaT;, &unknown; and %not-encoding", false],
  ["legitimate percentage", "50%", false],
  ["legitimate encoded URL", "https://example.org/a%2Fb", false],
  ["inert traversal", "../../secrets.txt", false],
  ["inert file URI", "file:///etc/passwd", false],
  ["legitimate Unicode", "Café démonstration", false],
  ["non-ASCII domain separator", "alice@\u00A0example.org", false],
  ["figure-space domain separator", "alice@\u2007example.org", false],
  ["narrow-no-break domain separator", "alice@\u202Fexample.org", false],
  ["ideographic-space domain separator", "alice@\u3000example.org", false],
  ["C0-separated local token", "ali\u0000ce@example.org", false],
  ["colon-separated local token", "ali:ce@example.org", true],
  ["unknown colon label", "unknown:alice@example.org", true],
  ["comma-separated local token", "ali,ce@example.org", true],
  ["semicolon-separated local token", "ali;ce@example.org", true],
  ["closing-parenthesis-separated local token", "ali)ce@example.org", true],
  ["RFC slash atext email", "ali/ce@example.org", true],
  ["leading-dot local", ".alice@example.org", false],
  ["trailing-dot local", "alice.@example.org", false],
  ["double-dot local", "alice..ops@example.org", false],
  ["overlong local", `${"a".repeat(65)}@example.org`, false],
  ["internal prose quote", `foo"alice@example.org"`, false],
  ["prefixed quoted local", `x"alice"@example.org`, false],
  ["suffixed quoted local", `"alice"x@example.org`, false],
  ["leading-hyphen domain", "alice@-example.org", false],
  ["trailing-hyphen domain", "alice@example-.org", false],
  ["empty domain label", "alice@example..org", false],
  ["empty domain label with punctuation", "alice@example..org.", false],
  ["overlong domain label", `alice@${"a".repeat(64)}.org`, false],
  ["single-letter TLD", "alice@example.c", false],
  ["maximum public non-email", "a".repeat(65_536), false],
  ["normalization expansion overflow", "ﷺ".repeat(4_000), true],
  ["maximum malformed quoted local", `${"a".repeat(65_520)}"@example.org`, false],
];

export function publicSourceScannerSelfTestFailures(): string[] {
  const failures: string[] = [];
  for (const [label, value, expectedSensitive] of publicSourceScannerSelfTests) {
    if (containsSensitivePublicMarker(value) !== expectedSensitive) failures.push(label);
  }
  return failures;
}
