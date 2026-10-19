/**
 * Guard for text that is about to be read as YAML.
 *
 * Why: `Bun.YAML.parse` stops reading at a NUL (U+0000) without saying so, and the
 * same class (other control characters, a no-break space, line separators, a byte
 * order mark, an unpaired surrogate) is read differently by the parser and by any
 * line-based scan placed in front of it. A caller that scans the lines and then
 * parses sees two different documents: the scan approves text that the parser
 * silently drops. Every YAML-backed input therefore runs this guard FIRST and
 * refuses the text when it returns a hit.
 *
 * The allow-class is a whitelist, not a list of bad characters: LF; U+0020 to
 * U+007E; U+00A1 to U+D7FF except U+2028 and U+2029; U+E000 to U+FFFD except
 * U+FEFF; U+10000 to U+10FFFF.
 * A CRLF pair counts as one newline (it is removed first, so line numbers stay
 * right); a bare CR, a tab, DEL, every C1 control (including U+0085), U+00A0,
 * U+2028, U+2029, U+FEFF, U+FFFE, U+FFFF and an unpaired surrogate are all hits.
 */

export interface UnreadableCharacter {
  readonly line: number;
  readonly codePoint: string;
}

const UNREADABLE =
  /[^\n\x20-\x7E\u{A1}-\u{2027}\u{202A}-\u{D7FF}\u{E000}-\u{FEFE}\u{FF00}-\u{FFFD}\u{10000}-\u{10FFFF}]/u;

/** The first character outside the allow-class, with its 1-based line, or `null`. */
export function findUnreadableCharacter(text: string): UnreadableCharacter | null {
  const normalized = text.replaceAll("\r\n", "\n");
  const hit = UNREADABLE.exec(normalized);
  if (hit === null) return null;
  const hex = (hit[0].codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0");
  return { line: normalized.slice(0, hit.index).split("\n").length, codePoint: `U+${hex}` };
}
