/**
 * The one reader of the invariants register (`docs/decisions/INVARIANTS.md`).
 *
 * Two gates read the register's rows and their standing: the threat-model
 * citations gate and the brick map. Until 2026-11-16 each carried its own
 * expression, and they disagreed on the only retired row the register holds:
 * the brick map read I-35 withdrawn, the citations gate read it in force and
 * printed "0 retired". Its expression ended on `\b` after « Retiré », and a
 * word boundary of a non-Unicode expression never holds between « é » and a
 * space — both are non-word characters to it. Every citation of the withdrawn
 * invariant therefore resolved as live.
 *
 * One reader cannot disagree with itself, so both gates call this one.
 *
 * WHAT IS A ROW. `| I-NN | cell |` at the start of a line: an identifier of two
 * or three digits, the form the brick schema admits (`^I-[0-9]{2,3}$`), and a
 * cell that is closed by a bar. The two former expressions differed here too
 * (the brick map: two or three digits, no closing bar asked; the citations
 * gate: any number of digits, a closing bar asked). The shared one takes what
 * BOTH took. Wherever it differs from one of them, it reads a row less, never
 * a row more: a line that is not a row makes every citation of it fail as
 * unknown, which is the loud direction.
 *
 * WHAT IS RETIRED. A row whose invariant cell, emphasis marks aside, is struck
 * through (`~~…`) or opens with the word « Retiré », « Retirée », « Retirés »,
 * « Retirées », "Retired" or "Withdrawn", in any case. The cell is compared in
 * NFC, and the accent is optional: « Retire le … » and an « é » written as a
 * letter and a combining mark were read retired by the brick map before the
 * merge, and a retirement that stops being read is the silent direction. The
 * word must END there: a living invariant that opens with « Retirer une
 * installation… » or "Retirement…" stays in force. The end of the word is
 * tested on Unicode letters, never on `\b`.
 */

export interface RegisterEntry {
  readonly id: string;
  readonly retired: boolean;
}

export interface ParsedRegister {
  readonly entries: ReadonlyMap<string, RegisterEntry>;
  readonly duplicates: readonly string[];
}

const REGISTER_ROW = /^\|\s*(I-[0-9]{2,3})\s*\|([^|]*)\|/;
const RETIRED_CELL = /^[\s*_]*(?:~~|(?:retir[ée]e?s?|retired|withdrawn)(?!\p{L}))/iu;

/** `| I-NN | text … |` rows, in the order written; a repeated id is reported. */
export function parseInvariantsRegister(text: string): ParsedRegister {
  const entries = new Map<string, RegisterEntry>();
  const duplicates: string[] = [];
  for (const line of text.split("\n")) {
    const match = REGISTER_ROW.exec(line);
    if (match === null) continue;
    const id = match[1] ?? "";
    if (entries.has(id)) duplicates.push(id);
    entries.set(id, { id, retired: RETIRED_CELL.test((match[2] ?? "").normalize("NFC")) });
  }
  return { entries, duplicates };
}
